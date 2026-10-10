/**
 * The main service, driven through the real SDK.
 *
 * `app.js` was the one module with no coverage: it opens a websocket on import and the SDK
 * is not in the repository, so nothing could reach it. Both obstacles turned out to be
 * redirectable - see helpers/sdk-resolver.mjs - so the service is now exercised the way
 * the host exercises it, by frames arriving on the socket, and observed the way the deck
 * observes it, by the frames going back out.
 *
 * That closes the gap where a real defect sat untested: a partial settings message used to
 * rebuild the action's settings from the defaults, so saving a preset list put the dial's
 * own step back to its default and editing that step emptied the presets.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./helpers/sdk-resolver.mjs', import.meta.url);

const ws = await import('./helpers/fake-ws.mjs');
await import('../plugin/service/app.js');

const UUID = 'com.ulanzi.ulanzistudio.neewer';
const socket = ws.opened[0];

/** A frame arriving from the host, the way the SDK hands it over. */
/**
 * A frame arriving from the host, the way the SDK hands it over.
 *
 * `key` and `actionid` make the context, and the service remembers things per context -
 * the encoder layout above all - so a test that needs a key of its own says which.
 */
function host(cmd, payload = {}) {
  const { key = '3_3', actionid = 'abc', ...rest } = payload;
  socket.onmessage({
    data: JSON.stringify({ uuid: `${UUID}.hue`, key, actionid, ...rest, cmd }),
  });
}

const contextOf = (key, actionid) => `${UUID}.hue___${key}___${actionid}`;

/** What the service pushed back to a panel, ignoring the SDK's own echo of the inbound. */
function echoed() {
  const frames = ws.sent.splice(0).map((raw) => JSON.parse(raw));
  return frames.reverse().find((f) => f.cmd === 'paramfromplugin' && f.param)?.param;
}

test('a settings message keeps the settings it does not mention', () => {
  // Two messages from a panel, the second about something else entirely.
  host('didReceiveSettings', { settings: { presets: '200,240', presetNames: 'Sunset,Night', step: 30 } });
  echoed();

  host('didReceiveSettings', { settings: { step: 45 } });

  const settings = echoed();
  assert.ok(settings, 'the panel was answered');
  assert.equal(settings.step, 45, 'the field the second message carried was applied');
  assert.equal(settings.presets, '200,240', 'the preset list survived it');
  assert.equal(settings.presetNames, 'Sunset,Night', 'and so did the names');
});

test('a settings message does not resurrect the defaults it left out', () => {
  // The other direction: the panel saves only its presets, and the dial's own bounds are
  // not part of that message. They must not go back to their defaults.
  host('didReceiveSettings', { settings: { min: 20, max: 80 } });
  echoed();

  host('didReceiveSettings', { settings: { presets: '10,50' } });

  const settings = echoed();
  assert.equal(settings.presets, '10,50');
  assert.equal(settings.min, 20, 'the range the first message set is still in force');
  assert.equal(settings.max, 80);
});

/** Repaints are coalesced onto a later tick, so a test has to let the deck settle. */
const settle = () => new Promise((r) => setTimeout(r, 500));

test('the encoder layout is applied once per key, not on every repaint', async () => {
  // Switching the layout is what makes the host rebuild a key, and until the feedback
  // that follows it arrives the host has nothing to draw but the name of the state. That
  // is the "Saturation" flash on a dial: something else on the deck was touched, the dial
  // was repainted, and the layout switch started the cycle again. Buttons were never
  // affected, which is why only the dial flickered.
  const key = '4_1';
  host('add', { key, actionid: 'dial1', controller: 'Encoder' });
  await settle();
  const first = tally(ws.sent.splice(0));
  assert.equal(first.setFeedbackLayout, 1, 'the layout goes out when the key appears');
  assert.ok(first.setFeedback, 'and so does the first readout');

  for (const round of [1, 2, 3]) {
    host('didReceiveSettings', { key, actionid: 'dial1', settings: { step: 5 + round } });
    const after = tally(ws.sent.splice(0));
    assert.equal(after.setFeedbackLayout || 0, 0, `repaint ${round} changed nothing about the layout`);
    assert.equal(after.setFeedback, 1, `repaint ${round} still sent its content`);
  }
});

test('a key the host remounts gets its layout again', async () => {
  // Otherwise "once per key" would mean once per context, and the layout would never
  // reach a key the host had rebuilt from scratch.
  const key = '4_2';
  host('add', { key, actionid: 'dial2', controller: 'Encoder' });
  await settle();
  ws.sent.splice(0);

  host('clear', { key, actionid: 'dial2', param: [{ context: contextOf(key, 'dial2') }] });
  host('add', { key, actionid: 'dial2', controller: 'Encoder' });
  await settle();

  assert.equal(tally(ws.sent.splice(0)).setFeedbackLayout, 1, 'the layout went out again');
});

/** Counts the commands in a batch of raw frames. */
function tally(raws) {
  const counts = {};
  for (const raw of raws) {
    const cmd = JSON.parse(raw).cmd;
    counts[cmd] = (counts[cmd] || 0) + 1;
  }
  return counts;
}

test('a key with no light behind it still shows a level, not "undefined"', () => {
  // With no fixture bound there is no snapshot to read, and the placeholder that stood in
  // for it had no level fields at all: the key drew the literal text "undefined", which is
  // also what the host falls back to its state name over. The defaults are the honest
  // answer - they are what a light shows before anything has been commanded to it.
  host('add', { uuid: `${UUID}.saturation` });
  host('didReceiveSettings', { uuid: `${UUID}.saturation`, settings: { step: 5 } });

  const frames = ws.sent.splice(0).map((raw) => JSON.parse(raw));
  const drawn = frames.flatMap((f) =>
    f.cmd === 'setTitle' ? [f.param.text] : f.cmd === 'state' ? [f.param.statelist[0].textData] : []
  );
  assert.ok(drawn.length, 'the key was drawn');
  for (const text of drawn) {
    assert.doesNotMatch(String(text), /undefined/, `a key with no light drew "${text}"`);
  }
});

test('the service opens exactly one connection to the host', () => {
  // It is a main service: it holds the socket for the whole session and never reconnects
  // on its own, which is why the frames above reach it at all.
  assert.equal(ws.opened.length, 1);
  assert.match(socket.url, /^ws:\/\/127\.0\.0\.1:\d+$/);
});

test('an action it does not know produces no settings and no work', () => {
  // A host frame can name an action from an older or newer build. It must not create a
  // context, and must not send anything back to a panel.
  ws.sent.splice(0);
  host('didReceiveSettings', { uuid: `${UUID}.not-an-action`, settings: { step: 5 } });
  const frames = ws.sent.splice(0).map((raw) => JSON.parse(raw));
  assert.equal(
    frames.filter((f) => f.cmd === 'paramfromplugin').length,
    0,
    'nothing was pushed to a panel for an unknown action'
  );
});

test('a frame that is not JSON does not take the service down', () => {
  // The SDK parses the payload before anything else, so this throws inside it. The service
  // survives because it installs an uncaughtException handler that logs and carries on -
  // which is exactly why that handler exists, and it is only observable from out here.
  assert.throws(() => socket.onmessage({ data: 'this is not json' }), 'the SDK itself rejects it');

  // Still serving afterwards.
  host('didReceiveSettings', { settings: { step: 15 } });
  assert.equal(echoed()?.step, 15, 'the service carried on');
});

test('a frame with no fields at all is survivable', () => {
  assert.doesNotThrow(() => socket.onmessage({ data: JSON.stringify({ cmd: 'run' }) }));
  host('didReceiveSettings', { settings: { step: 25 } });
  assert.equal(echoed()?.step, 25);
});
