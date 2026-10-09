/**
 * Saturation on the dial - continuous rotation, and a press that walks presets.
 *
 * The button side is `saturation-up.js` / `saturation-down.js`. Saturation is not
 * a command of its own: it is a field of the 0x86 colour frame, so every step
 * resends the whole colour with the current hue. The 0-100 scale was measured on
 * a RGB62 on 2026-09-30 (see docs/session-2026-09-28-bluetooth.md).
 *
 * The default list starts at 0 because that is where the dial now rests: a light
 * that has never been touched reports no saturation at all, and a preset list
 * whose first entry was 100 would make the dial jump to full colour before the
 * user had asked for anything.
 *
 * Pressing the dial cycles the presets. That is a separate host event from a key
 * press (see the onDialUp wiring in app.js), so it lives in `onDialPress`.
 */

import { ACTION, LIMITS, STATE } from '../core/constants.js';
import { rotateSteps, walkList } from '../core/dial.js';
import { clamp, dialStep, parseList } from '../core/params.js';
import { setEncoderText, setStateIcon, setTitle } from '../core/ui.js';

export const uuid = ACTION.SATURATION;

export const defaults = {
  device: '',
  step: 5,
  min: LIMITS.SATURATION_MIN,
  max: LIMITS.SATURATION_MAX,
  presets: '0,50,75,100',
};

export function render({ $UD, context, snap, isEncoder }) {
  const value = `${snap.saturation}`;
  if (isEncoder) setEncoderText($UD, context, value, 'SAT');
  setStateIcon($UD, context, STATE.DEFAULT, value);
  setTitle($UD, context, `sat ${value}`);
}

export async function onDialRotate(ctx, message) {
  const { settings, light, snap, report } = ctx;
  const dir = rotateSteps(message);
  if (dir === 0) return;
  const min = clamp(settings.min, LIMITS.SATURATION_MIN, LIMITS.SATURATION_MAX, defaults.min);
  const max = clamp(settings.max, min, LIMITS.SATURATION_MAX, defaults.max);
  const step = dialStep(settings.step, 1, max - min, defaults.step, [1, 2, 5, 10, 25]);
  const next = Math.min(max, Math.max(min, snap.saturation + dir * step));
  if (next === snap.saturation) return;
  try {
    await light.setSaturation(next);
  } catch (err) {
    report(err);
  }
}

/** Pressing the dial steps to the next preset, wrapping at the end. */
export async function onDialPress(ctx) {
  const { settings, light, snap, report } = ctx;
  const min = clamp(settings.min, LIMITS.SATURATION_MIN, LIMITS.SATURATION_MAX, defaults.min);
  const max = clamp(settings.max, min, LIMITS.SATURATION_MAX, defaults.max);
  const presets = parseList(settings.presets ?? defaults.presets).map((v) => clamp(v, min, max, min));
  const next = walkList(presets, snap.saturation, (v) => v);
  if (next === null) return;
  try {
    await light.setSaturation(next);
  } catch (err) {
    report(err);
  }
}