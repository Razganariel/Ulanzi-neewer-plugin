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

import { ACTION, LIMITS } from '../core/constants.js';
import { rotateSteps, walkList } from '../core/dial.js';
import { clamp, dialStep } from '../core/params.js';
import { setEncoderText, setTitle } from '../core/ui.js';

export const uuid = ACTION.HUE;

export const defaults = {
  device: '',
  step: 10,
  presets: '0:100,30:100,60:100,120:100,180:100,240:100,300:100',
  presetNames: 'Red,Orange,Yellow,Green,Cyan,Blue,Magenta',
};

/** Hue goes 0-359 so that a full turn lands back on 0 instead of 360. */
const MAX = LIMITS.HUE.max - 1;

export function render({ $UD, context, snap, isEncoder }) {
  const value = `${snap.hue}`;
  if (isEncoder) setEncoderText($UD, context, value, 'HUE');
  setTitle($UD, context, value);
}

/**
 * Reads "hue[:saturation]" colours out of the settings string.
 *
 * A bare hue keeps the current saturation, which is what a plain degree list means
 * and what every preset saved before saturation existed means. Splitting only on
 * separators matters for the same reason it does in `cct.js`: a cell typed as
 * "120: 80" is one entry, and splitting on the space would shred the saturation.
 */
export function parseHuePresets(raw) {
  const out = [];
  for (const part of String(raw ?? '').split(/[,|]/)) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const [hue, saturation] = trimmed.split(':');
    const h = clamp(hue, LIMITS.HUE.min, MAX, null);
    if (h === null) continue;
    const s = saturation === undefined || saturation.trim() === ''
      ? null
      : clamp(saturation, LIMITS.SATURATION.min, LIMITS.SATURATION.max, null);
    out.push({ hue: h, saturation: s });
  }
  return out;
}

/**
 * Sets the hue, and the saturation when the preset names one.
 *
 * Omitting the saturation leaves it alone: `setHsl` defaults it to the current
 * value, so a bare hue preset does not quietly flatten a colour the user dialled in.
 */
export async function applyPreset(ctx, hue, saturation = null) {
  const { light, report } = ctx;
  try {
    await light.setHsl(hue, saturation ?? light.state.saturation);
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

/**
 * Next preset after the current hue, or null when the list is empty.
 *
 * Stepped by position through the shared dial helper, so a preset the property
 * inspector appended below the current ones is still reached on every lap.
 */
export function nextHuePreset(ctx, presets) {
  const { settings, snap } = ctx;
  const list = parseHuePresets(presets ?? settings.presets ?? defaults.presets);
  return walkList(list, snap.hue, (preset) => preset.hue);
}

/**
 * Walks the preset list by one, wrapping at the end. Shared by
 * `hue-presets.js` and this module's own dial press, so the two never drift.
 */
export async function applyNextHuePreset(ctx, presets) {
  const next = nextHuePreset(ctx, presets);
  if (next === null) return;
  await applyPreset(ctx, next.hue, next.saturation);
}

/** Pressing the dial walks the same preset list as the dedicated Hue Presets key. */
export async function onDialPress(ctx) {
  await applyNextHuePreset(ctx);
}