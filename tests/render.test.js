/**
 * Rendering contract for the keys, and the controller routing that decides whether
 * an encoder readout is sent at all.
 *
 * Both regressions behind this file produced a blank Stream Deck key:
 *
 *  - `DisableAutomaticStates: true` made the host draw nothing, and index 0 of
 *    every action was the "fixture unreachable" icon, so a dropped key showed a
 *    grey cross rather than the action.
 *  - the encoder readout was decided from the manifest, where brightness/hue/
 *    saturation/cct/scan all list both Keypad and Encoder. Every instance was
 *    therefore treated as a dial, and setFeedbackLayout/setFeedback were fired on
 *    plain buttons, where the host accepts them and blanks the key.
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
import * as saturation from '../plugin/service/actions/saturation.js';
import * as saturationUp from '../plugin/service/actions/saturation-up.js';
import * as saturationDown from '../plugin/service/actions/saturation-down.js';
import * as cct from '../plugin/service/actions/cct.js';
import * as cctPresets from '../plugin/service/actions/cct-presets.js';
import * as cctUp from '../plugin/service/actions/cct-up.js';
import * as cctDown from '../plugin/service/actions/cct-down.js';
import * as scan from '../plugin/service/actions/scan.js';
import { STATE } from '../plugin/service/core/constants.js';

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
const draw = (mod, { isEncoder = false, snap = {} } = {}) => {
  const $UD = fakeUD();
  mod.render({ $UD, context: 'ctx', snap: snapOf(snap), isEncoder });
  return $UD.sent;
};

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

test('the drawn state does not depend on whether the lamp is reachable', () => {
  // Link status used to flip the icon, which is what produced the mismatch: the
  // payload said connected while the key kept the waiting icon.
  for (const mod of [brightness, hue, saturation, cct]) {
    const up = draw(mod, { snap: { connected: true } }).find((c) => c[0] === 'state');
    const down = draw(mod, { snap: { connected: false } }).find((c) => c[0] === 'state');
    assert.equal(up[1], STATE.DEFAULT, `${mod.uuid} draws its own state`);
    assert.equal(down[1], up[1], `${mod.uuid} keeps the same icon when the lamp drops out`);
  }
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
    assert.ok(sent.some((c) => c[0] === 'state'), `${mod.uuid} still draws its icon`);
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
    const $UD = fakeUD();
    mod.render({ $UD, context: 'ctx', snap: snapOf({ brightness: 50, saturation: 70 }) });
    const drawn = $UD.sent.filter((c) => c[0] === 'state');
    assert.ok(drawn.length > 0, `${mod.uuid} paints its key`);
    assert.ok(
      drawn.every((c) => String(c[2]).includes(value)),
      `${mod.uuid} shows the current value, not a fixed label`
    );
  }
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
