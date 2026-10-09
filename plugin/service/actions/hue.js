/**
 * Hue action - one dial of its own, and the button runs the same presets.
 *
 * Turning walks the hue by a fixed step (10 degrees by default, measured as what
 * the D200X feels right at); a press jumps to the next preset in the list.
 * Presets are also reachable from dedicated keys, which call the same
 * `applyPreset` helper rather than duplicating the frame logic.
 *
 * A dial press and a key press are different host events (see the onDialUp wiring
 * in app.js), so both call `cyclePreset` rather than one calling the other.
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
  setTitle($UD, context, `Hue `);
}

/** Jump to one preset; shared with the dedicated preset keys. */
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
export function nextHuePreset(ctx) {
  const { settings, snap } = ctx;
  const presets = parseList(settings.presets ?? defaults.presets).map((hue) => clamp(hue, 0, MAX, 0));
  return nextPreset(presets, snap.hue);
}

export async function onRun(ctx) {
  const { light, report } = ctx;
  const next = nextHuePreset(ctx);
  if (next === null) return;
  try {
    await light.setHsl(next);
  } catch (err) {
    report(err);
  }
}

/** Pressing the dial runs the same preset list as the button. */
export async function onDialPress(ctx) {
  await onRun(ctx);
}