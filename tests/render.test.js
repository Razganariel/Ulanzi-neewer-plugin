/**
 * Rendering contract for the keys, and the controller routing that decides whether
 * an encoder readout is sent at all.
 *
 * Both regressions behind this file produced a blank Stream Deck key:
 *
 *  - `DisableAutomaticStates: true` made the host draw nothing, and index 0 of
 *    every action was the "fixture unreachable" icon, so a dropped key showed a
 *    grey cross rather than the action.
 *  - the encoder readout was decided from the manifest, where the dial actions
 *    used to list both Keypad and Encoder. Every instance was therefore treated as
 *    a dial, and setFeedbackLayout/setFeedback were fired on plain buttons, where
 *    the host accepts them and blanks the key.
 *
 * Keys also used to carry a "waiting for connection" state. The host mounts a key
 * after announcing it, so the frame that corrected the icon arrived too early and
 * was dropped: every key stayed on the waiting icon while the lamp was being
 * driven normally. Only Power keeps two states now, because on/off is what the
 * action does rather than link status.
 *
 * The manifest is asserted here because it is data, not code, and nothing else in
 * the suite would notice the flag coming back.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as brightness from '../plugin/service/actions/brightness.js';
import * as brightnessUp from '../plugin/service/actions/brightness-up.js';
import * as brightnessDown from '../plugin/service/actions/brightness-down.js';
import * as hue from '../plugin/service/actions/hue.js';
import * as huePresets from '../plugin/service/actions/hue-presets.js';
import * as hueUp from '../plugin/service/actions/hue-up.js';
import * as hueDown from '../plugin/service/actions/hue-down.js';
import * as saturation from '../plugin/service/actions/saturation.js';
import * as saturationUp from '../plugin/service/actions/saturation-up.js';
import * as saturationDown from '../plugin/service/actions/saturation-down.js';
import * as cct from '../plugin/service/actions/cct.js';
import * as cctPresets from '../plugin/service/actions/cct-presets.js';
import * as cctUp from '../plugin/service/actions/cct-up.js';
import * as cctDown from '../plugin/service/actions/cct-down.js';
import * as scan from '../plugin/service/actions/scan.js';
import * as power from '../plugin/service/actions/power.js';
import { DEFAULTS, STATE } from '../plugin/service/core/constants.js';

const manifest = JSON.parse(readFileSync(new URL('../plugin/manifest.json', import.meta.url), 'utf8'));
const actionOf = (uuid) => manifest.Actions.find((a) => a.UUID === uuid);

/** Records only what the render path asks the host to draw. */
function fakeUD() {
  const sent = [];
  return {
    sent,
    setStateIcon(context, state, text) { sent.push(['state', state, text]); },
    setTitle(context, text) { sent.push(['title', text]); },
    setFeedbackLayout(context, layout) { sent.push(['layout', layout]); },
    setFeedback(context, layout) { sent.push(['feedback', layout]); },
  };
}

const snapOf = (snap) => ({ connected: true, brightness: 40, hue: 30, saturation: 70, cct: 5600, ...snap });
// Each draw is a key of its own unless the test says otherwise, because the service
// remembers what it has drawn per key: the encoder layout and the state icon go out once.
// A test that means "the same key, repainted" passes the same context explicitly; every
// other test is comparing renderings of separate keys.
let drawnKeys = 0;
const draw = (mod, { isEncoder = false, snap = {}, context } = {}) => {
  const $UD = fakeUD();
  const key = context ?? `ctx-${mod.uuid}-${(drawnKeys += 1)}`;
  mod.render({ $UD, context: key, snap: snapOf(snap), isEncoder });
  return $UD.sent;
};

const countOf = (sent, kind) => sent.filter((c) => c[0] === kind).length;

test('no dial paints a state icon at all', () => {
  // The manifest omits DisableAutomaticStates, so the host already draws the declared
  // state by itself - every shipped Ulanzi plugin does this. Sending it again was the last
  // frame that could put the name of the state on the key, and on a dial it appeared for
  // a frame ("CCT") whenever the host rebuilt the key. The level is carried by setTitle on
  // a button and setFeedback on a dial, so nothing is lost.
  for (const mod of [brightness, hue, saturation, cct]) {
    const first = draw(mod, { isEncoder: true });
    assert.equal(countOf(first, 'state'), 0, `${mod.uuid} sent a state icon`);
    assert.ok(countOf(first, 'feedback'), `${mod.uuid} still sends its level`);
  }
  // The presets keys are buttons, so their level travels through the title.
  for (const mod of [huePresets, cctPresets]) {
    const first = draw(mod);
    assert.equal(countOf(first, 'state'), 0, `${mod.uuid} sent a state icon`);
    assert.equal(countOf(first, 'title'), 1, `${mod.uuid} still sends its level`);
  }
});

test('no dial repaints the same key twice over', () => {
  // Changing the encoder layout makes the host rebuild the key, and until the feedback
  // that follows arrives it has nothing to draw but the name of the state. The layout
  // never changes, so it goes out once per key and the content keeps going out every time.
  //
  // All four dials, each on a context of its own, so one key's first draw never pays for
  // another's.
  for (const mod of [brightness, hue, saturation, cct]) {
    const context = `once-${mod.uuid}`;
    const first = draw(mod, { isEncoder: true, context, snap: { cct: 3400 } });
    assert.equal(countOf(first, 'layout'), 1, `${mod.uuid} applied its layout when it appeared`);
    assert.equal(countOf(first, 'feedback'), 1, `${mod.uuid} sent its first readout`);

    for (let round = 1; round <= 3; round += 1) {
      const after = draw(mod, { isEncoder: true, context, snap: { cct: 3400 + round } });
      assert.equal(countOf(after, 'layout'), 0, `${mod.uuid} repaint ${round} changed the layout`);
      // The level is what the repaint is for, and it goes out every time.
      assert.equal(countOf(after, 'feedback'), 1, `${mod.uuid} repaint ${round} sent its content`);
      assert.equal(countOf(after, 'title'), 1, `${mod.uuid} repaint ${round} titled the key`);
    }
  }
});

test('a button never touches the encoder layout', () => {
  // The counterpart, and why only dials ever flickered.
  for (const mod of [brightnessUp, saturationDown, cctUp, hueDown, power]) {
    const sent = draw(mod, { context: `ctx-btn-${mod.uuid}` });
    assert.equal(countOf(sent, 'layout'), 0, `${mod.uuid} sent a layout change`);
    assert.equal(countOf(sent, 'feedback'), 0, `${mod.uuid} sent encoder feedback`);
  }
});

test('the manifest must not disable automatic states', () => {
  // Every shipped Ulanzi plugin omits the flag, and with it set the host draws
  // nothing until the plugin answers. A key dropped while the service is starting
  // stays blank, which is exactly the reported symptom.
  for (const action of manifest.Actions) {
    assert.equal(
      action.DisableAutomaticStates,
      undefined,
      `${action.Name} sets DisableAutomaticStates; the host would draw nothing`
    );
  }
});

test('every action draws a real icon, and only Power has more than one state', () => {
  for (const action of manifest.Actions) {
    const [first] = action.States;
    assert.equal(
      first.Image,
      action.Icon,
      `${action.Name} state 0 must be its own icon, otherwise a dropped key shows the wrong thing`
    );
    if (action.Name === 'Power') continue;
    assert.equal(
      action.States.length,
      1,
      `${action.Name} declares a single state: link status belongs to the property inspector`
    );
  }
});

test('no action paints a waiting-for-connection icon on the deck', () => {
  // Regression: a "disconnected" state made every key look broken while the lamp
  // was in fact being driven, and the corrective repaint raced the key mounting.
  const rel = new URL('../plugin/manifest.json', import.meta.url);
  const raw = JSON.parse(readFileSync(rel, 'utf8'));
  for (const action of raw.Actions) {
    for (const state of action.States) {
      assert.doesNotMatch(
        state.Image,
        /disconnected/i,
        `${action.Name} must not reference the waiting-for-connection icon`
      );
    }
  }
});

test('state indices agree with the manifest', () => {
  for (const [uuid, expected] of [
    [brightness.uuid, 'Brightness'],
    [hue.uuid, 'Hue'],
    [saturation.uuid, 'Saturation'],
    [cct.uuid, 'CCT'],
  ]) {
    assert.equal(actionOf(uuid).States[STATE.DEFAULT].Name, expected);
  }
});

test('what a key draws does not depend on whether the lamp is reachable', () => {
  // Link status used to flip the icon, which is what produced the mismatch: the payload
  // said connected while the key kept the waiting icon. The dials no longer draw an icon
  // at all - the host paints the declared state - so what is left to compare is the level,
  // and it must not move when the link drops.
  for (const mod of [brightness, hue, saturation, cct]) {
    const level = (connected) => {
      const sent = draw(mod, { isEncoder: true, snap: { connected } });
      const title = sent.find((c) => c[0] === 'title');
      const feedback = sent.find((c) => c[0] === 'feedback');
      return JSON.stringify([title?.[1], feedback?.[1]]);
    };
    assert.equal(level(true), level(false), `${mod.uuid} draws the same thing either way`);
  }
});

test('the actions whose state really changes still draw it', () => {
  // Power and Scan are the two the host cannot guess: one flips between its states, the
  // other shows a count that changes. Everything else declares a single state whose image
  // is constant, which the host already draws.
  const on = draw(power, { snap: { power: true } }).find((c) => c[0] === 'state');
  const off = draw(power, { snap: { power: false } }).find((c) => c[0] === 'state');
  assert.ok(on && off, 'power draws a state');
  assert.notEqual(on[1], off[1], 'and the two states differ');

  const scanFrames = draw(scan, { knownDevices: () => [{ id: 'a' }, { id: 'b' }] });
  assert.ok(
    scanFrames.some((c) => c[0] === 'state'),
    'scan draws the number of registered lights'
  );
});

test('an encoder instance gets the dial readout', () => {
  const sent = draw(brightness, { isEncoder: true, snap: { brightness: 42 } });
  assert.ok(sent.some((c) => c[0] === 'layout' && c[1] === '$UA1'), 'the built-in layout is selected');
  const feedback = sent.find((c) => c[0] === 'feedback');
  assert.ok(feedback, 'the readout value is pushed');
  assert.match(feedback[1].title.text, /42/, 'the current value is on the dial');
});

test('a keypad instance gets no encoder command at all', () => {
  // This is the regression: setFeedbackLayout/setFeedback on a button is accepted
  // by the host (code 0) and leaves the key blank instead of drawing it.
  for (const mod of [brightness, hue, saturation, cct]) {
    const sent = draw(mod, { isEncoder: false });
    assert.ok(
      !sent.some((c) => c[0] === 'layout' || c[0] === 'feedback'),
      `${mod.uuid} must not send encoder commands from a button`
    );
    // A button instance still gets its level, through the title.
    assert.equal(countOf(sent, 'title'), 1, `${mod.uuid} titles the key`);
  }
});

test('only dial-capable actions declare the Encoder controller', () => {
  const encoders = manifest.Actions
    .filter((a) => (a.Controllers || []).includes('Encoder'))
    .map((a) => a.UUID);
  assert.deepEqual(
    encoders.sort(),
    [brightness.uuid, hue.uuid, saturation.uuid, cct.uuid].sort(),
    'power and scan are button-only: neither has anything a dial could change'
  );
});

test('brightness and saturation split into a dial and two one-step buttons', () => {
  // A dial sweeps continuously; a button can only nudge. Keeping one action for
  // both meant the button had to either cycle presets or jump to full, neither of
  // which is a plain "one step".
  for (const dial of [brightness, saturation]) {
    const declared = actionOf(dial.uuid);
    assert.deepEqual(declared.Controllers, ['Encoder'], `${dial.uuid} is the dial now`);
    assert.equal(dial.onRun, undefined, `${dial.uuid} no longer answers a key press`);
    assert.equal(typeof dial.onDialRotate, 'function', `${dial.uuid} still sweeps`);
  }
  for (const button of [brightnessUp, brightnessDown, saturationUp, saturationDown]) {
    const declared = actionOf(button.uuid);
    assert.deepEqual(declared.Controllers, ['Keypad'], `${button.uuid} is a button only`);
    assert.equal(declared.Encoder, undefined, `${button.uuid} declares no dial layout`);
    assert.equal(typeof button.onRun, 'function', `${button.uuid} answers a press`);
    assert.equal(button.onDialRotate, undefined, `${button.uuid} has no sweep`);
    assert.ok(button.defaults.step > 0, `${button.uuid} has a usable default step`);
  }
});

test('hue splits its tap into a preset walk and two one-step buttons', () => {
  // Same shape as the CCT split: the dial keeps the sweep, and each button does
  // exactly one of the two things a tap used to have to choose between.
  const declared = actionOf(hue.uuid);
  assert.deepEqual(declared.Controllers, ['Encoder'], 'the hue dial sweeps');
  assert.equal(hue.onRun, undefined, 'an Encoder-only action never gets a key press');
  assert.equal(typeof hue.onDialRotate, 'function', 'the hue dial still sweeps');
  assert.equal(typeof hue.onDialPress, 'function', 'the dial press walks the presets');

  assert.deepEqual(actionOf(huePresets.uuid).Controllers, ['Keypad']);
  assert.equal(typeof huePresets.onRun, 'function', 'presets answer a press');
  assert.equal(huePresets.onDialRotate, undefined);
  assert.ok(huePresets.defaults.presets, 'presets carry a default list');

  for (const step of [hueUp, hueDown]) {
    const declaredStep = actionOf(step.uuid);
    assert.deepEqual(declaredStep.Controllers, ['Keypad'], `${step.uuid} is a button only`);
    assert.equal(declaredStep.Encoder, undefined, `${step.uuid} declares no dial layout`);
    assert.equal(typeof step.onRun, 'function', `${step.uuid} answers a press`);
    assert.equal(step.onDialRotate, undefined, `${step.uuid} has no sweep`);
    assert.ok(step.defaults.step > 0, `${step.uuid} has a usable default step`);
  }
  assert.notEqual(hueUp.uuid, hueDown.uuid, 'up and down are two distinct actions');
});

test('the temperature key keeps its level while the lamp is in colour mode', () => {
  // The reported failure: a CCT action showed the temperature, then a Hue or Saturation
  // action put the CCT key and dial back to "HSL". A mode is not a level, and it says
  // nothing about the setting those keys are about. The three dials beside it - hue,
  // saturation, brightness - show their value whatever the lamp is doing, and a colour
  // command leaves the remembered temperature alone, so there is a real number to show.
  for (const mod of [cct, cctPresets, cctUp, cctDown]) {
    // Two different keys, because a second draw of the same key is a repaint and a
    // repaint deliberately does not repeat the icon or the layout. What is compared here
    // is the content: the title and the dial readout.
    const content = (suffix, snap) =>
      draw(mod, { snap, context: `mode-${suffix}-${mod.uuid}` })
        .filter((c) => c[0] === 'title' || c[0] === 'feedback')
        .map((c) => [c[0], c[1]?.title?.text ?? c[1]]);
    const inColour = content('hsl', { mode: 'hsl', cct: 3400 });
    const inCct = content('cct', { mode: 'cct', cct: 3400 });

    assert.deepEqual(inColour[0], ['title', '3400K'], `${mod.uuid} titles the temperature, not the mode`);
    assert.deepEqual(
      inColour,
      inCct,
      `${mod.uuid} draws the same thing in either mode`
    );

    // The encoder readout too: it is the only place with room for the unit.
    const encoder = draw(mod, {
      isEncoder: true,
      snap: { mode: 'hsl', cct: 3400 },
      context: `mode-encoder-${mod.uuid}`,
    });
    const feedback = encoder.find((c) => c[0] === 'feedback');
    if (feedback) {
      assert.match(JSON.stringify(feedback[1]), /3400/, `${mod.uuid} encoder shows the level`);
    }
  }
});

test('every hue key draws the value it is about to move', () => {  for (const mod of [huePresets, hueUp, hueDown]) {
    const sent = draw(mod, { snap: { hue: 120 } });
    assert.ok(sent.some((c) => c[0] === 'title'), `${mod.uuid} paints its key`);
    const title = sent.find((c) => c[0] === 'title');
    assert.ok(title, `${mod.uuid} titles its key`);
    // The title is the level and nothing else. It used to be `hue up (120)`, which is
    // long enough to be cut on a small key and buries the only part that changes.
    assert.equal(String(title[1]).replace(/[^\d]/g, ''), '120', `${mod.uuid} shows the level`);
    assert.ok(
      !/[()a-z]/i.test(String(title[1])),
      `${mod.uuid} carries no label around the value, got "${title[1]}"`
    );
    assert.ok(
      !sent.some((c) => c[0] === 'layout' || c[0] === 'feedback'),
      `${mod.uuid} is a button and must not send encoder commands`
    );
  }
});

test('cct splits its tap into a scene walk and a plain temperature step', () => {
  // The CCT key used to have to be either a scene jump or a nudge. The dial kept
  // the sweep, and each button now does exactly one of the two.
  const declared = actionOf(cct.uuid);
  assert.deepEqual(declared.Controllers, ['Encoder'], 'the CCT dial sweeps');
  assert.equal(cct.onRun, undefined, 'the CCT dial no longer answers a key press');
  assert.equal(typeof cct.onDialRotate, 'function', 'the CCT dial still sweeps');

  assert.deepEqual(actionOf(cctPresets.uuid).Controllers, ['Keypad']);
  assert.equal(typeof cctPresets.onRun, 'function', 'presets answer a press');
  assert.equal(cctPresets.onDialRotate, undefined);
  assert.ok(cctPresets.defaults.presets, 'presets carry the measured scenes');

  for (const step of [cctUp, cctDown]) {
    const declared = actionOf(step.uuid);
    assert.deepEqual(declared.Controllers, ['Keypad'], `${step.uuid} is a button only`);
    assert.equal(declared.Encoder, undefined, `${step.uuid} declares no dial layout`);
    assert.equal(typeof step.onRun, 'function', `${step.uuid} answers a press`);
    assert.equal(step.onDialRotate, undefined, `${step.uuid} has no sweep`);
    assert.equal(step.defaults.step, 200, '200 K by default, finer than the dial');
  }
  assert.notEqual(cctUp.uuid, cctDown.uuid, 'up and down are two distinct actions');
});

test('the one-step buttons draw the value they are about to move', () => {
  for (const [mod, value] of [[brightnessUp, '50%'], [brightnessDown, '50%'], [saturationUp, '70'], [saturationDown, '70']]) {
    const sent = draw(mod, { snap: { brightness: 50, saturation: 70 } });
    const title = sent.find((c) => c[0] === 'title');
    assert.ok(title, `${mod.uuid} titles its key`);
    assert.equal(
      String(title[1]),
      value,
      `${mod.uuid} shows the current value, not a fixed label`
    );
    // Its icon still carries the value too, drawn once with the key.
    const drawn = sent.filter((c) => c[0] === 'state');
    assert.ok(drawn.length > 0, `${mod.uuid} drew its icon`);
    assert.ok(
      drawn.every((c) => String(c[2]).includes(value)),
      `${mod.uuid} puts the value on the icon as well`
    );
  }
});

test('a light the plugin has never spoken to reads as OFF, not ON', () => {
  // The regression, from a real session: the default was power: true, so starting
  // UlanziDeck painted the key ON while the lamp was off, and the first press was
  // swallowed sending "off" to a lamp that was already off. The toggle was one press
  // out for the whole session.
  assert.equal(DEFAULTS.POWER, false, 'a fixture is off until a command says otherwise');

  const $UD = fakeUD();
  power.render({ $UD, context: 'ctx', snap: snapOf({ power: DEFAULTS.POWER }) });
  const drawn = $UD.sent.find((c) => c[0] === 'state');
  assert.equal(drawn[1], 0, 'state 0 is the Off icon');
  assert.equal(drawn[2], 'OFF');
});

test('one press on a fresh fixture turns it on', async () => {
  // The whole point of the default: the toggle has to land on the lamp the first time.
  const calls = [];
  const light = {
    state: { power: DEFAULTS.POWER },
    setPower(on) { calls.push(['setPower', on]); this.state.power = on; },
    togglePower() { return this.setPower(!this.state.power); },
  };
  await power.onRun({ settings: power.defaults, light, report: () => {} });
  assert.deepEqual(calls, [['setPower', true]]);
});

test('nothing the deck shows is invented at render time', () => {
  // Behavioural guard on the one thing that bit: a lamp the plugin has never spoken to
  // reads as off, so the deck never claims a light is on. `light.test.js` covers the
  // restored-state half of this.
  const drawn = draw(power, { snap: { power: false } });
  assert.ok(
    drawn.some((c) => c[0] === 'state' && c[1] === 0),
    'a fresh fixture is drawn in the Off state, not On'
  );
});

test('scan is button-only and never sends a dial readout', () => {
  const declared = actionOf(scan.uuid);
  assert.deepEqual(declared.Controllers, ['Keypad'], 'scan no longer offers a dial');
  assert.equal(declared.Encoder, undefined, 'no encoder layout is declared');
  const $UD = fakeUD();
  scan.render({ $UD, context: 'ctx', snap: snapOf({}), isEncoder: true, knownDevices: () => [] });
  assert.ok(
    !$UD.sent.some((c) => c[0] === 'layout' || c[0] === 'feedback'),
    'a stale Encoder placement must not receive dial commands'
  );
});
