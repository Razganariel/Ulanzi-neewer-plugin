/**
 * CCT on the dial - continuous and bidirectional.
 *
 * The button side lives in `cct-presets.js` (walk the measured scenes) and
 * `cct-up.js` / `cct-down.js` (nudge the temperature by a fixed step), which is
 * what one key press used to have to choose between. This module is the dial
 * alone.
 *
 * The protocol carries the temperature in a single byte of 100 K steps
 * (protocol.js `cctFrame`), so a finer dial step than 100 K cannot express
 * anything new; 250 K is the default because it sweeps 2500-8500 in 25 notches.
 *
 * Presets are "kelvin:brightness" pairs rather than bare temperatures: the scenes
 * measured with a colour meter each carry their own brightness (a candle reads
 * 28% while a cold blue reads 100%), and `setCct` keeps the *current* brightness,
 * so a temperature-only preset would apply the right colour at the wrong level.
 * A bare "kelvin" is still accepted and keeps the current brightness.
 */

import { ACTION, LIMITS } from '../core/constants.js';
import { dialBounds, rotateSteps, walkList } from '../core/dial.js';
import { bool, clamp, dialStep, wrap } from '../core/params.js';
import { setEncoderText, setTitle } from '../core/ui.js';

export const uuid = ACTION.CCT;

export const defaults = {
  device: '',
  step: 200,
  min: LIMITS.CCT.min,
  max: LIMITS.CCT.max,
  wrap: true,
  presets: '3400:28,4500:16,5000:16,5600:28,6500:100',
  presetNames: 'Candle,Sunset,Afternoon light,Sunlight,Cold blue light',
};

function bounds(settings) {
  return dialBounds(settings, LIMITS.CCT, defaults);
}

export function render({ $UD, context, snap, isEncoder }) {
  // The temperature, whatever the lamp is currently doing. It used to show "HSL" while
  // the lamp was in colour mode, which is a mode and not a level: the key is about the
  // temperature, and the three dials beside it show their value whatever the mode. The
  // command itself leaves the remembered temperature alone, so the number shown here is
  // the one a press would move from.
  const value = `${snap.cct}K`;
  if (isEncoder) setEncoderText($UD, context, value, 'CCT');
  setTitle($UD, context, value);
}

export async function onDialRotate(ctx, message) {
  const { settings, light, snap, report } = ctx;
  const dir = rotateSteps(message);
  if (dir === 0) return;
  const { min, max } = bounds(settings);
  // 100 K is the wire granularity: the temperature travels as one byte of 100 K, so a
  // step that is not a multiple of 100 lands between two values the protocol can carry.
  // 250 K was offered here until now, and 2500 + 250 = 2750 is not expressible: the
  // frame rounds it and the lamp does not land where the dial said it would.
  const step = dialStep(settings.step, 100, max - min, defaults.step, [100, 200, 500, 1000]);
  const raw = snap.cct + dir * step;
  const next = bool(settings.wrap, defaults.wrap) ? wrap(raw, min, max) : clamp(raw, min, max, snap.cct);
  try {
    await light.setCct(next);
  } catch (err) {
    report(err);
  }
}

/**
 * Reads "kelvin[:brightness]" scenes out of the settings string.
 * A bare kelvin keeps the current brightness, which is what a plain temperature
 * list means.
 */
export function parseScenes(raw, min, max) {
  const out = [];
  // Split on separators only, never on whitespace: a scene typed as "3200: 50"
  // is one entry, and splitting on the space after the colon would shred the
  // brightness into a fragment of its own.
  for (const part of String(raw ?? '').split(/[,|]/)) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const [kelvin, brightness] = trimmed.split(':');
    const k = clamp(kelvin, min, max, null);
    if (k === null) continue;
    const b = brightness === undefined
      ? null
      : clamp(brightness, LIMITS.BRIGHTNESS.min, LIMITS.BRIGHTNESS.max, null);
    out.push({ kelvin: k, brightness: b });
  }
  return out;
}

/**
 * Walks the scene list by one, wrapping at the end. Shared by `cct-presets.js` and
 * this module's own dial press, so the two cannot drift apart.
 */
export async function applyNextScene(ctx, presets) {
  const { settings, light, snap, report } = ctx;
  const { min, max } = bounds(settings);
  const scenes = parseScenes(presets ?? settings.presets, min, max);
  const next = walkList(scenes, snap.mode === 'cct' ? snap.cct : -1, (scene) => scene.kelvin);
  if (!next) return;
  try {
    await light.setCct(next.kelvin, next.brightness ?? light.state.brightness);
  } catch (err) {
    report(err);
  }
}

/** Pressing the dial walks the same scene list as the dedicated CCT Presets key. */
export async function onDialPress(ctx) {
  await applyNextScene(ctx, ctx.settings.presets);
}