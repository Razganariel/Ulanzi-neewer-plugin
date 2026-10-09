/**
 * Hue action - the dial, and the dial alone.
 *
 * Turning walks the hue by a fixed step (10 degrees by default, measured as what
 * the D200X feels right at). The button side of the hue lives in
 * `hue-presets.js` (walk the preset list), `hue-up.js` and `hue-down.js` (nudge
 * by a fixed step), which is what one key press used to have to choose between.
 *
 * Pressing the dial is its own host event (see the onDialUp wiring in app.js), so
 * it walks the presets directly rather than relying on a key press.
 */

import { ACTION, LIMITS, STATE } from '../core/constants.js';
import { rotateSteps } from '../core/dial.js';
import { clamp, dialStep, nextPreset, parseList } from '../core/params.js';
import { setEncoderText, setStateIcon, setTitle } from '../core/ui.js';

export const uuid = ACTION.HUE;

export const defaults = {
  device: '',
  step: 10,
  presets: '0,30,60,120,180,240,300',
};

/** Hue goes 0-359 so that a full turn lands back on 0 instead of 360. */
const MAX = LIMITS.HUE_MAX - 1;

export function render({ $UD, context, snap, isEncoder }) {
  const value = `${snap.hue}`;
  if (isEncoder) setEncoderText($UD, context, value, 'HUE');
  setStateIcon($UD, context, STATE.DEFAULT, value);
  setTitle($UD, context, `hue ${value}`);
}

/** Sets the hue to one value, leaving saturation and brightness alone. */
export async function applyPreset(ctx, hue) {
  const { light, report } = ctx;
  try {
    await light.setHsl(hue);
  } catch (err) {
    report(err);
  }
}

export async function onDialRotate(ctx, message) {
  const { settings, light, report } = ctx;
  const dir = rotateSteps(message);
  if (dir === 0) return;
  const step = dialStep(settings.step, 1, MAX, defaults.step, [1, 2, 5, 10, 15, 30]);
  try {
    await light.stepHue(dir * step);
  } catch (err) {
    report(err);
  }
}

/** Next preset after the current hue, or null when the list is empty. */
export function nextHuePreset(ctx, presets) {
  const { settings, snap } = ctx;
  const list = parseList(presets ?? settings.presets ?? defaults.presets)
    .map((hue) => clamp(hue, 0, MAX, null))
    .filter((hue) => hue !== null);
  return nextPreset(list, snap.hue);
}

/**
 * Walks the preset list by one, wrapping at the end. Shared by
 * `hue-presets.js` and this module's own dial press, so the two never drift.
 */
export async function applyNextHuePreset(ctx, presets) {
  const next = nextHuePreset(ctx, presets);
  if (next === null) return;
  await applyPreset(ctx, next);
}

/** Pressing the dial walks the same preset list as the dedicated Hue Presets key. */
export async function onDialPress(ctx) {
  await applyNextHuePreset(ctx);
}