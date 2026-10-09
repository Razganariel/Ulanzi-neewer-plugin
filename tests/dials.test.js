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
import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../plugin/service/core/constants.js';
import * as hue from '../plugin/service/actions/hue.js';
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

test('hue press advances to the next preset and wraps', async () => {
  const light = L({ hue: 60 });
  await hue.onRun(ctxFor(light, { ...hue.defaults, presets: '0,60,120' }));
  assert.deepEqual(light.calls, [['setHsl', 120, 100, 100]]);

  const last = L({ hue: 120 });
  await hue.onRun(ctxFor(last, { ...hue.defaults, presets: '0,60,120' }));
  assert.deepEqual(last.calls, [['setHsl', 0, 100, 100]]);
});

test('hue press with no preset configured does nothing', async () => {
  const light = L();
  await hue.onRun(ctxFor(light, { ...hue.defaults, presets: '' }));
  assert.equal(light.calls.length, 0);
});

test('hue preset helper targets a single hue', async () => {
  const light = L();
  await hue.applyPreset(ctxFor(light, hue.defaults), 240);
  assert.deepEqual(light.calls, [['setHsl', 240, 100, 100]]);
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

test('a dial press is a separate host event from a key press', () => {
  // Guards the wiring: app.js must route onDialUp to onDialPress, because the
  // host never sends onRun for an encoder.
  const app = readFileSync(new URL('../plugin/service/app.js', import.meta.url), 'utf8');
  assert.match(app, /onDialUp\(/, 'app.js listens for the dial press event');
  assert.match(app, /onDialPress/, 'and routes it to the action hook');
  for (const mod of [brightness, saturation, hue]) {
    assert.equal(typeof mod.onDialPress, 'function', `${mod.uuid} answers a dial press`);
  }
  // CCT dial has its presets on press, too.
  assert.equal(typeof cct.onDialPress, 'function', 'cct answers a dial press');
});