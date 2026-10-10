/**
 * Encoder action behaviour.
 *
 * Each dial action is driven through a fake light so the tests can assert the
 * exact frame-driving calls without touching the radio: what matters here is
 * which setter each dial calls and with what value, since a dial wired to the
 * wrong setter is precisely how the saturation setting used to go nowhere.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../plugin/service/core/constants.js';
import { dialBounds, nextValueInList, rotateSteps, walkList } from '../plugin/service/core/dial.js';
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
import * as brightness from '../plugin/service/actions/brightness.js';
import * as brightnessUp from '../plugin/service/actions/brightness-up.js';
import * as brightnessDown from '../plugin/service/actions/brightness-down.js';

const L = (snap) => ({
  calls: [],
  state: { connected: true, mode: 'hsl', hue: 0, saturation: 100, brightness: 100, cct: 5600, ...snap },
  // Mirrors light.js: an omitted argument means "keep the current value".
  // Deliberately does not normalise the hue: setHsl does that inside light.js, so
  // a step that runs off the end of the wheel is asserted here as the raw value the
  // dial asked for and is asserted normalised in protocol.test.js.
  setHsl(h, s, b) {
    this.calls.push(['setHsl', h ?? this.state.hue, s ?? this.state.saturation, b ?? this.state.brightness]);
  },
  setBrightness(v) { this.calls.push(['setBrightness', v]); },
  // stepHue/stepCct exist so the hue and CCT dials reuse light.js' own wrapping.
  stepHue(d) { this.setHsl(this.state.hue + d); },
  stepCct(d) { this.setCct(this.state.cct + d); },
  setSaturation(v) { this.calls.push(['setSaturation', v]); },
  // The one-step buttons call these, and light.js clamps them internally.
  stepBrightness(d) { this.setBrightness(this.state.brightness + d); },
  stepSaturation(d) { this.setHsl(this.state.hue, this.state.saturation + d); },
  // Mirrors light.js `setCct`, which runs the value through normalizeCct before
  // building the frame: without that clamp here, a step that overshoots a bound
  // would look like it sent an out-of-range temperature.
  setCct(k, b) {
    const kelvin = Math.min(8500, Math.max(2500, Math.round(k)));
    this.calls.push(['setCct', kelvin, b ?? this.state.brightness]);
  },
});
const LEFT = { rotateEvent: 'left' };
const RIGHT = { rotateEvent: 'right' };
const ctxFor = (light, settings) => ({ light, snap: light.state, settings, report: () => {} });

test('hue dial steps by the configured amount', async () => {
  const light = L({ hue: 30 });
  await hue.onDialRotate(ctxFor(light, { ...hue.defaults, step: 10 }), RIGHT);
  assert.deepEqual(light.calls, [['setHsl', 40, 100, 100]], 'saturation rides along, never dropped');
});

test('hue dial walks down and wraps below zero', async () => {
  const light = L({ hue: 5 });
  await hue.onDialRotate(ctxFor(light, { ...hue.defaults, step: 10 }), LEFT);
  // setHsl normalises inside light.js: -5 becomes 355, asserted there.
  assert.deepEqual(light.calls, [['setHsl', -5, 100, 100]]);
});

test('hue dial ignores an unknown rotation', async () => {
  const light = L();
  await hue.onDialRotate(ctxFor(light, hue.defaults), { rotateEvent: 'none' });
  assert.equal(light.calls.length, 0);
});

test('hue dial press advances to the next preset and wraps', async () => {
  // A dial press is its own host event (onDialUp), not a key press: the action is
  // Encoder-only, so onRun would never fire for it.
  const light = L({ hue: 60 });
  await hue.onDialPress(ctxFor(light, { ...hue.defaults, presets: '0,60,120' }));
  assert.deepEqual(light.calls, [['setHsl', 120, 100, 100]]);

  const last = L({ hue: 120 });
  await hue.onDialPress(ctxFor(last, { ...hue.defaults, presets: '0,60,120' }));
  assert.deepEqual(last.calls, [['setHsl', 0, 100, 100]]);
});

test('hue dial press with no preset configured does nothing', async () => {
  const light = L();
  await hue.onDialPress(ctxFor(light, { ...hue.defaults, presets: '' }));
  assert.equal(light.calls.length, 0);
});

test('hue preset helper targets a single hue', async () => {
  const light = L();
  await hue.applyPreset(ctxFor(light, hue.defaults), 240);
  assert.deepEqual(light.calls, [['setHsl', 240, 100, 100]]);
});

test('a scene added below the others still comes up', async () => {
  // The regression, from a real session: the property inspector appends new scenes at
  // the end, so "4000" landed after "6500". A walk that searched for the first scene
  // above the current value jumped from 6500 straight back to 3400, and the appended
  // scene was never reached at all.
  const settings = { ...cctPresets.defaults, presets: '3400:28,4500:16,5000:16,5600:28,6500:100,4000:10' };
  const entries = settings.presets.split(',').length;
  const walk = [];
  // One full lap starting from a scene in the middle of the list.
  for (let i = 0; i < entries; i += 1) {
    const light = L({ mode: 'cct', cct: walk.length ? walk[walk.length - 1] : 5000 });
    await cctPresets.onRun(ctxFor(light, settings));
    walk.push(light.calls[0][1]);
  }
  assert.deepEqual(
    walk,
    [5600, 6500, 4000, 3400, 4500, 5000],
    'every scene, including the one appended below the others, is reached once per lap'
  );
});

test('every dial answers a press, and none of them answers a key press', () => {
  // A dial press is its own host event: the host never sends onRun for an encoder, so
  // the hook has to exist on all four and only on the press side. A dial action that
  // grew an onRun would be one a button could silently drive.
  for (const mod of [brightness, saturation, hue, cct]) {
    assert.equal(typeof mod.onDialPress, 'function', `${mod.uuid} answers a dial press`);
    assert.equal(mod.onRun, undefined, `${mod.uuid} answers no key press`);
  }
});

test('the preset walk is stepped by position, not by value', () => {
  // The concept shared by every dial: one step along the list from the entry in use,
  // wrapping at the end. A value search would skip anything the user entered out of
  // order, which is what the property inspector produces when a low preset is added
  // to a list of higher ones.
  const list = [50, 25, 75, 100];
  const walk = [];
  let current = 50;
  for (let i = 0; i < list.length; i += 1) {
    current = walkList(list, current, (v) => v);
    walk.push(current);
  }
  assert.deepEqual(walk, [25, 75, 100, 50], 'every entry is reached once per lap');
});

test('the walk reaches an entry appended below the others, on every dial', async () => {
  // One shared helper, so one regression test covers brightness, saturation, CCT and
  // Hue. Each list has its out-of-order entry last, exactly as the inspector appends.
  const cases = [
    {
      name: 'brightness',
      run: (light, settings) => brightness.onDialPress(ctxFor(light, settings)),
      settings: { ...brightness.defaults, presets: '75,100,25' },
      snap: { brightness: 100 },
      read: (calls) => calls[0][1],
      expected: [25, 75, 100],
    },
    {
      name: 'saturation',
      run: (light, settings) => saturation.onDialPress(ctxFor(light, settings)),
      settings: { ...saturation.defaults, presets: '75,100,25' },
      snap: { saturation: 100 },
      read: (calls) => calls[0][1],
      expected: [25, 75, 100],
    },
  ];
  for (const c of cases) {
    let value = c.snap[Object.keys(c.snap)[0]];
    const walk = [];
    for (let i = 0; i < c.expected.length; i += 1) {
      const light = L({ ...c.snap, [Object.keys(c.snap)[0]]: value });
      await c.run(light, c.settings);
      value = c.read(light.calls);
      walk.push(value);
    }
    assert.deepEqual(walk, c.expected, `${c.name} reaches the entry it appended last`);
  }
});

test('rotation is untouched by the preset walk', async () => {
  // The walk only ever runs on a press. A rotation must keep behaving exactly as it
  // did: a signed step off the current value, and clamped at the bounds by default.
  const up = L({ hue: 350, saturation: 100, brightness: 100 });
  await hue.onDialRotate(ctxFor(up, hue.defaults), RIGHT);
  assert.deepEqual(up.calls, [['setHsl', 360, 100, 100]], 'raw value, normalised inside the protocol');

  const clamped = L({ brightness: 2 });
  await brightness.onDialRotate(ctxFor(clamped, brightness.defaults), LEFT);
  assert.deepEqual(clamped.calls, [['setBrightness', 1]], 'stops at the low end');

  const wrapped = L({ brightness: 2 });
  await brightness.onDialRotate(ctxFor(wrapped, { ...brightness.defaults, wrap: true }), LEFT);
  assert.deepEqual(wrapped.calls, [['setBrightness', 97]], 'comes round only when asked to');

  const ignored = L({ hue: 0 });
  await hue.onDialRotate(ctxFor(ignored, hue.defaults), { rotateEvent: 'none' });
  assert.equal(ignored.calls.length, 0, 'an event that is not a rotation moves nothing');
});

test('a dial parked at the top does not drop the lamp to the bottom', () => {
  // The report: with the deck claiming 100% and wrap on, one notch forward produced
  // 105 -> 5, so the lamp fell to its dimmest. Nothing about brightness is cyclic, and
  // the up/down buttons already stopped at the limits; the dial now agrees with them.
  const atTop = L({ brightness: 100 });
  return brightness
    .onDialRotate(ctxFor(atTop, brightness.defaults), RIGHT)
    .then(() => {
      assert.deepEqual(atTop.calls, [['setBrightness', 100]], 'and stays at the top');
    });
});

test('rotateSteps is still the only decoder, holds included', () => {
  assert.equal(rotateSteps({ rotateEvent: 'left' }), -1);
  assert.equal(rotateSteps({ rotateEvent: 'hold-left' }), -1);
  assert.equal(rotateSteps({ rotateEvent: 'right' }), 1);
  assert.equal(rotateSteps({ rotateEvent: 'hold-right' }), 1);
  assert.equal(rotateSteps({ rotateEvent: 'none' }), 0);
  assert.equal(rotateSteps(undefined), 0);
});

test('the sweep range is the one the panel asked for, inside what the field allows', () => {
  const limits = { min: 1, max: 100 };
  const fallback = { min: 1, max: 100 };

  assert.deepEqual(dialBounds({ min: 20, max: 80 }, limits, fallback), { min: 20, max: 80 });
  // A range wider than the field would command a value the fixture cannot take.
  assert.deepEqual(dialBounds({ min: -50, max: 500 }, limits, fallback), { min: 1, max: 100 });
  // Absent or unusable settings fall back rather than sweeping nothing.
  assert.deepEqual(dialBounds({}, limits, fallback), { min: 1, max: 100 });
  assert.deepEqual(dialBounds({ min: '', max: 'x' }, limits, fallback), { min: 1, max: 100 });
});

test('a range that crosses itself collapses instead of sweeping backwards', () => {
  // The order the two clamps are applied in is the whole point: `max` is read against
  // the resolved `min`, so a stored maximum under the minimum collapses onto it rather
  // than producing a range that turns the other way.
  const limits = { min: 0, max: 100 };
  const fallback = { min: 0, max: 100 };
  assert.deepEqual(dialBounds({ min: 80, max: 20 }, limits, fallback), { min: 80, max: 80 });
});

test('a preset left outside the sweep range is pulled back into it', () => {
  // Otherwise the lamp would be sent a value the action clamps again, landing on
  // something the user never chose. 10 and 90 become the bounds they are nearest.
  const bounds = { min: 20, max: 80 };
  const defaults = { presets: '10,50,90' };
  // The lamp is showing 25, so the walk goes to the next stored entry, clamped.
  assert.equal(nextValueInList({ presets: '10,50,90' }, 25, defaults, bounds), 50);
  // Sitting on the last entry, it wraps to the first, which was below the range.
  assert.equal(nextValueInList({ presets: '10,50,90' }, 90, defaults, bounds), 20, 'wrapped to the clamped first entry');
  // An empty list is not a value, and the caller must be able to tell.
  assert.equal(nextValueInList({ presets: '' }, 50, { presets: '' }, bounds), null);
});

test('the stored default list is used when the settings carry none', () => {
  const bounds = { min: 1, max: 100 };
  assert.equal(nextValueInList({}, 25, { presets: '25,50,75,100' }, bounds), 50);
});

test('a hue preset added below the others still comes up', async () => {
  const settings = { ...huePresets.defaults, presets: '0:100,120:100,240:100,45:100' };
  const walk = [];
  for (let i = 0; i < 4; i += 1) {
    const light = L({ hue: walk.length ? walk[walk.length - 1] : 120 });
    await huePresets.onRun(ctxFor(light, settings));
    walk.push(light.calls[0][1]);
  }
  assert.deepEqual(walk, [240, 45, 0, 120]);
});

test('a light sitting between two presets still moves forward', async () => {
  // Nothing to step from when the dial swept the light off a preset, so the walk
  // starts at the first preset above it rather than going backwards.
  const settings = { ...cctPresets.defaults, presets: '3400,4500,6500' };
  const between = L({ mode: 'cct', cct: 4000 });
  await cctPresets.onRun(ctxFor(between, settings));
  assert.deepEqual(between.calls, [['setCct', 4500, 100]]);

  const past = L({ mode: 'cct', cct: 9000 });
  await cctPresets.onRun(ctxFor(past, settings));
  assert.deepEqual(past.calls, [['setCct', 3400, 100]], 'past the last one, start over');
});

test('the Hue Presets key walks the list the dial press does', async () => {
  // Same helper on purpose: a dedicated key that drifted from the dial's own press
  // would make the two disagree about what the next preset is.
  const key = L({ hue: 30 });
  await huePresets.onRun(ctxFor(key, { ...huePresets.defaults, presets: '0,30,60,120' }));
  assert.deepEqual(key.calls, [['setHsl', 60, 100, 100]]);

  const dial = L({ hue: 30 });
  await hue.onDialPress(ctxFor(dial, { ...hue.defaults, presets: '0,30,60,120' }));
  assert.deepEqual(dial.calls, key.calls);
});

test('a hue preset applies its saturation as well as its hue', async () => {
  // A colour needs both: at saturation 0 the hue is invisible, so a hue-only preset
  // would land on nothing whenever the dial happened to be at zero.
  const light = L({ hue: 0, saturation: 0 });
  await huePresets.onRun(ctxFor(light, { ...huePresets.defaults, presets: '30:80,120:20' }));
  assert.deepEqual(light.calls, [['setHsl', 30, 80, 100]]);

  const next = L({ hue: 30, saturation: 80 });
  await huePresets.onRun(ctxFor(next, { ...huePresets.defaults, presets: '30:80,120:20' }));
  assert.deepEqual(next.calls, [['setHsl', 120, 20, 100]]);
});

test('a bare hue preset keeps the saturation the dial left', async () => {
  // Presets saved before saturation existed are bare degrees, and the dial may be
  // parked on a vivid colour that must survive the press.
  const light = L({ hue: 0, saturation: 65 });
  await huePresets.onRun(ctxFor(light, { ...huePresets.defaults, presets: '0,120,240' }));
  assert.deepEqual(light.calls, [['setHsl', 120, 65, 100]]);
});

test('the hue preset list ignores what it cannot put on the wire', () => {
  assert.deepEqual(hue.parseHuePresets('0:100,junk,120:999'), [
    { hue: 0, saturation: 100 },
    { hue: 120, saturation: 100 },
  ]);
  // A bare hue, a "hue:" with nothing after it, and a separator on either side are
  // all one entry each.
  assert.deepEqual(hue.parseHuePresets(' 30 , 120: , | 240 '), [
    { hue: 30, saturation: null },
    { hue: 120, saturation: null },
    { hue: 240, saturation: null },
  ]);
  // A space after the colon is part of the same cell, not a second one.
  assert.deepEqual(hue.parseHuePresets('120: 80'), [{ hue: 120, saturation: 80 }]);
});

test('the hue nudge buttons step the same amount in both directions', async () => {
  // The hue wraps rather than clamping, so a button never gets stuck on a bound:
  // light.js setHsl normalises whatever comes out of the step (see protocol.test.js).
  const up = L({ hue: 30 });
  await hueUp.onRun(ctxFor(up, hueUp.defaults));
  assert.deepEqual(up.calls, [['setHsl', 60, 100, 100]]);

  const down = L({ hue: 30 });
  await hueDown.onRun(ctxFor(down, hueDown.defaults));
  assert.deepEqual(down.calls, [['setHsl', 0, 100, 100]]);

  // Off the top of the wheel: the raw value leaves, setHsl wraps it to 0.
  const over = L({ hue: 350 });
  await hueUp.onRun(ctxFor(over, hueUp.defaults));
  assert.deepEqual(over.calls, [['setHsl', 380, 100, 100]]);

  // A junk step must fall back to the default rather than freezing the key.
  const junk = L({ hue: 0 });
  await hueUp.onRun(ctxFor(junk, { ...hueUp.defaults, step: 'nonsense' }));
  assert.deepEqual(junk.calls, [['setHsl', 30, 100, 100]]);
});

test('saturation dial calls setSaturation, not setHsl', async () => {
  const light = L({ hue: 240, saturation: 100 });
  await saturation.onDialRotate(ctxFor(light, { ...saturation.defaults, step: 5 }), LEFT);
  assert.deepEqual(light.calls, [['setSaturation', 95]]);
});

test('saturation dial stops at its bounds instead of wrapping', async () => {
  const light = L({ saturation: 2 });
  await saturation.onDialRotate(ctxFor(light, { ...saturation.defaults, step: 5 }), LEFT);
  assert.deepEqual(light.calls, [['setSaturation', 0]]);

  const top = L({ saturation: 98 });
  await saturation.onDialRotate(ctxFor(top, { ...saturation.defaults, step: 5 }), RIGHT);
  assert.deepEqual(top.calls, [['setSaturation', 100]]);
});

test('saturation dial honours a custom step', async () => {
  const light = L({ saturation: 50 });
  await saturation.onDialRotate(ctxFor(light, { ...saturation.defaults, step: 10 }), RIGHT);
  assert.deepEqual(light.calls, [['setSaturation', 60]]);
});

test('saturation dial sends nothing when already at the bound', async () => {
  const light = L({ saturation: 100 });
  await saturation.onDialRotate(ctxFor(light, { ...saturation.defaults, step: 5 }), RIGHT);
  assert.equal(light.calls.length, 0, 'no redundant frame at the limit');
});

test('saturation press moves one step up, hue riding along', async () => {
  const light = L({ hue: 30, saturation: 40 });
  await saturationUp.onRun(ctxFor(light, saturationUp.defaults));
  assert.deepEqual(light.calls, [['setHsl', 30, 45, 100]], 'saturation is a field of the colour frame');
});

test('saturation press moves one step down', async () => {
  const light = L({ hue: 30, saturation: 40 });
  await saturationDown.onRun(ctxFor(light, saturationDown.defaults));
  assert.deepEqual(light.calls, [['setHsl', 30, 35, 100]]);
});

test('saturation press honours a custom step', async () => {
  const light = L({ hue: 30, saturation: 50 });
  await saturationUp.onRun(ctxFor(light, { ...saturationUp.defaults, step: 25 }));
  assert.deepEqual(light.calls, [['setHsl', 30, 75, 100]]);
});

test('brightness press moves one step in each direction', async () => {
  const up = L({ brightness: 50 });
  await brightnessUp.onRun(ctxFor(up, brightnessUp.defaults));
  assert.deepEqual(up.calls, [['setBrightness', 55]]);
  const down = L({ brightness: 50 });
  await brightnessDown.onRun(ctxFor(down, brightnessDown.defaults));
  assert.deepEqual(down.calls, [['setBrightness', 45]]);
});

test('a step that would make the button useless falls back to the default', async () => {
  const light = L({ brightness: 50 });
  await brightnessUp.onRun(ctxFor(light, { ...brightnessUp.defaults, step: '' }));
  assert.deepEqual(light.calls, [['setBrightness', 55]], 'blank keeps 5%, not 0');
  const silly = L({ brightness: 50 });
  await brightnessUp.onRun(ctxFor(silly, { ...brightnessUp.defaults, step: 9999 }));
  assert.deepEqual(silly.calls, [['setBrightness', 75]], 'a step above the ceiling is capped at 25');
});

test('cct presets press walks the measured scenes, brightness included', async () => {
  // Scenes are "kelvin:brightness": a candle measured at 28% must not land at
  // whatever brightness the dial happened to be left on.
  const light = L({ mode: 'cct', cct: 2000, brightness: 100 });
  for (const expected of [[3400, 28], [4500, 16], [5000, 16], [5600, 28], [6500, 100]]) {
    await cctPresets.onRun(ctxFor(light, cctPresets.defaults));
    // The walk is driven off the live snapshot, so feed it back the way the
    // host would after a real state refresh.
    light.state.cct = expected[0];
    light.state.mode = 'cct';
    assert.deepEqual(light.calls.at(-1), ['setCct', expected[0], expected[1]]);
  }
});

test('cct presets press wraps back to the first scene', async () => {
  const light = L({ mode: 'cct', cct: 7000 });
  await cctPresets.onRun(ctxFor(light, cctPresets.defaults));
  assert.deepEqual(light.calls, [['setCct', 3400, 28]]);
});

test('a bare kelvin preset keeps the current brightness', () => {
  assert.deepEqual(cct.parseScenes('3200', 2500, 8500), [{ kelvin: 3200, brightness: null }]);
  assert.deepEqual(cct.parseScenes('3200:50', 2500, 8500), [{ kelvin: 3200, brightness: 50 }]);
  assert.deepEqual(cct.parseScenes('3200: 50, 4000:70', 2500, 8500), [
    { kelvin: 3200, brightness: 50 },
    { kelvin: 4000, brightness: 70 },
  ]);
  assert.deepEqual(cct.parseScenes('', 2500, 8500), [], 'empty stays empty, so a press is a no-op');
  assert.deepEqual(cct.parseScenes('nonsense', 2500, 8500), []);
  // Out-of-range values are pulled into the range rather than dropped.
  assert.deepEqual(cct.parseScenes('9000:200', 2500, 8500), [{ kelvin: 8500, brightness: 100 }]);
});

test('cct dial steps by kelvin, and wraps back to the warm end', async () => {
  const light = L({ mode: 'cct', cct: 5600 });
  await cct.onDialRotate(ctxFor(light, { ...cct.defaults, step: 250 }), LEFT);
  assert.deepEqual(light.calls, [['setCct', 5350, 100]]);

  // wrap defaults to true: 2600 - 250 = 2350 lands below the floor and wraps to
  // the cool end of the range.
  const bottom = L({ mode: 'cct', cct: 2600 });
  await cct.onDialRotate(ctxFor(bottom, { ...cct.defaults, step: 250 }), LEFT);
  assert.deepEqual(bottom.calls, [['setCct', 8351, 100]]);
});

test('cct dial can be told to stop at the ends', async () => {
  const light = L({ mode: 'cct', cct: 8350 });
  await cct.onDialRotate(ctxFor(light, { ...cct.defaults, step: 250, wrap: 'false' }), RIGHT);
  assert.deepEqual(light.calls, [['setCct', 8500, 100]]);
});

test('cct presets press uses the presets, and is inert while the list is empty', async () => {
  const light = L({ mode: 'cct', cct: 4000 });
  await cctPresets.onRun(ctxFor(light, { ...cctPresets.defaults, presets: '3200,4000,5600' }));
  assert.deepEqual(light.calls, [['setCct', 5600, 100]]);

  const none = L({ mode: 'cct', cct: 4000 });
  await cctPresets.onRun(ctxFor(none, { ...cctPresets.defaults, presets: '' }));
  assert.equal(none.calls.length, 0);
});

test('cct up and down move in opposite directions and keep the brightness', async () => {
  // The dial or a scene may have left any brightness behind; a temperature nudge
  // must not silently reset it, so setCct is called with one argument only.
  const up = L({ mode: 'cct', cct: 5000, brightness: 28 });
  await cctUp.onRun(ctxFor(up, cctUp.defaults));
  // 28 is the fake's stand-in for "whatever was left there": the action calls
  // setCct with one argument, so light.js keeps the current brightness.
  assert.deepEqual(up.calls, [['setCct', 5200, 28]], 'up is the default 200 K step, brightness preserved');

  const down = L({ mode: 'cct', cct: 5000, brightness: 28 });
  await cctDown.onRun(ctxFor(down, cctDown.defaults));
  assert.deepEqual(down.calls, [['setCct', 4800, 28]], 'down goes the other way');
});

test('a cct press stops at the bounds instead of wrapping', async () => {
  const top = L({ mode: 'cct', cct: 8400 });
  await cctUp.onRun(ctxFor(top, cctUp.defaults));
  assert.deepEqual(top.calls, [['setCct', 8500, 100]]);

  const bottom = L({ mode: 'cct', cct: 2600 });
  await cctDown.onRun(ctxFor(bottom, cctDown.defaults));
  assert.deepEqual(bottom.calls, [['setCct', 2500, 100]]);

  // Already at a bound: no redundant frame.
  const done = L({ mode: 'cct', cct: 8500 });
  await cctUp.onRun(ctxFor(done, cctUp.defaults));
  assert.equal(done.calls.length, 0);
  const warm = L({ mode: 'cct', cct: 2500 });
  await cctDown.onRun(ctxFor(warm, cctDown.defaults));
  assert.equal(warm.calls.length, 0);
});

test('cct up and down honour a custom step', async () => {
  const up = L({ mode: 'cct', cct: 4000 });
  await cctUp.onRun(ctxFor(up, { ...cctUp.defaults, step: 500 }));
  assert.deepEqual(up.calls, [['setCct', 4500, 100]]);

  const down = L({ mode: 'cct', cct: 4000 });
  await cctDown.onRun(ctxFor(down, { ...cctDown.defaults, step: 500 }));
  assert.deepEqual(down.calls, [['setCct', 3500, 100]]);
});

test('a cct step off the wire grid falls back to the default', async () => {
  // The frame carries one byte of 100 K, so 350 K would land on 400 K. A value
  // under 100 K cannot be expressed at all and must not become 0.
  const rounded = L({ mode: 'cct', cct: 4000 });
  await cctUp.onRun(ctxFor(rounded, { ...cctUp.defaults, step: 350 }));
  assert.deepEqual(rounded.calls, [['setCct', 4400, 100]], '350 K rounds onto the 100 K grid');

  const blank = L({ mode: 'cct', cct: 4000 });
  await cctUp.onRun(ctxFor(blank, { ...cctUp.defaults, step: '' }));
  assert.deepEqual(blank.calls, [['setCct', 4200, 100]], 'blank keeps the 200 K default');

  const tooSmall = L({ mode: 'cct', cct: 4000 });
  await cctUp.onRun(ctxFor(tooSmall, { ...cctUp.defaults, step: 40 }));
  assert.deepEqual(tooSmall.calls, [['setCct', 4200, 100]], 'below one grid unit keeps the default');
});

test('brightness dial keeps its 5% step', async () => {
  const light = L({ brightness: 50, mode: 'hsl' });
  await brightness.onDialRotate(ctxFor(light, { ...brightness.defaults, step: 5 }), RIGHT);
  assert.deepEqual(light.calls, [['setBrightness', 55]]);
});

test('every dial action is bound to its own UUID', () => {
  const ids = [hue.uuid, saturation.uuid, cct.uuid, brightness.uuid];
  assert.equal(new Set(ids).size, 4, 'no two dials share a UUID');
});

test('pressing a dial walks the presets of every dial that has them', async () => {
  // The host reports a dial press as onDialUp, never as onRun, so an action that
  // only implemented onRun was silently inert on a dial.
  const bri = L({ brightness: 10 });
  await brightness.onDialPress(ctxFor(bri, brightness.defaults));
  assert.deepEqual(bri.calls, [['setBrightness', 25]], 'brightness lands on the first preset');

  const briMid = L({ brightness: 50 });
  await brightness.onDialPress(ctxFor(briMid, { ...brightness.defaults, presets: '25,50,75,100' }));
  assert.deepEqual(briMid.calls, [['setBrightness', 75]], 'and skips forward from where it is');

  const briLast = L({ brightness: 100 });
  await brightness.onDialPress(ctxFor(briLast, brightness.defaults));
  assert.deepEqual(briLast.calls, [['setBrightness', 25]], 'wrapping at the end');

  const sat = L({ saturation: 0 });
  await saturation.onDialPress(ctxFor(sat, saturation.defaults));
  assert.deepEqual(sat.calls, [['setSaturation', 50]], 'saturation has its own preset list');

  const hueLight = L({ hue: 30 });
  await hue.onDialPress(ctxFor(hueLight, hue.defaults));
  assert.deepEqual(hueLight.calls, [['setHsl', 60, 100, 100]], 'hue keeps its hue presets');

  const cctLight = L({ mode: 'cct', cct: 2000, brightness: 100 });
  await cct.onDialPress(ctxFor(cctLight, cct.defaults));
  assert.deepEqual(cctLight.calls, [['setCct', 3400, 28]], 'cct walks its measured scenes');
});

test('a dial press with an empty preset list sends nothing', async () => {
  const bri = L({ brightness: 50 });
  await brightness.onDialPress(ctxFor(bri, { ...brightness.defaults, presets: '' }));
  assert.equal(bri.calls.length, 0);

  const sat = L({ saturation: 50 });
  await saturation.onDialPress(ctxFor(sat, { ...saturation.defaults, presets: '' }));
  assert.equal(sat.calls.length, 0);
});

test('saturation starts from 0, not from full colour', async () => {
  // The deck shows this before the light has ever reported a value; claiming full
  // saturation up front put the readout and the first preset jump nowhere useful.
  assert.equal(DEFAULTS.SATURATION, 0);
  assert.equal(saturation.defaults.presets.split(',')[0], '0', 'the list starts at the same 0');
});

