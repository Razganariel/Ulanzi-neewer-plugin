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
function host(cmd, payload = {}) {
  socket.onmessage({
    data: JSON.stringify({ uuid: `${UUID}.hue`, key: '3_3', actionid: 'abc', ...payload, cmd }),
  });
}

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
