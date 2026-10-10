/**
 * Brightness on the dial - continuous rotation, and a press that walks presets.
 *
 * The button side of brightness is `brightness-up.js` / `brightness-down.js`,
 * which move one clamped step per press. This module exists for the dial alone:
 * a dial can sweep, so it wraps at the limits rather than sticking.
 *
 * Pressing the dial cycles the preset list. That is a separate host event from a
 * key press (see the onDialUp wiring in app.js), so it lives in `onDialPress`
 * rather than `onRun`.
 */

import { ACTION, LIMITS, STATE } from '../core/constants.js';
import { dialBounds, nextValueInList, rotateSteps } from '../core/dial.js';
import { bool, clamp, dialStep, wrap } from '../core/params.js';
import { setEncoderText, setStateIcon, setTitle } from '../core/ui.js';

export const uuid = ACTION.BRIGHTNESS;

export const defaults = {
  device: '',
  min: LIMITS.BRIGHTNESS.min,
  max: LIMITS.BRIGHTNESS.max,
  step: 5,
  // Stops at the limits rather than coming back round, like the up/down buttons do:
  // a dial parked at 100% and turned one more notch used to drop the lamp to 5%, which
  // reads as a fault rather than as the end of the range. Nothing about brightness is
  // cyclic, so wrapping only ever produces a jump nobody asked for. Set it back to
  // true in the property inspector to sweep endlessly instead.
  wrap: false,
  presets: '25,50,75,100',
};

export function render({ $UD, context, snap, isEncoder }) {
  if (isEncoder) setEncoderText($UD, context, snap.brightness, 'BRI %');
  setStateIcon($UD, context, STATE.DEFAULT, String(snap.brightness));
  setTitle($UD, context, `${snap.brightness}%`);
}

export async function onDialRotate(ctx, message) {
  const { settings, light, snap, report } = ctx;
  const dir = rotateSteps(message);
  if (dir === 0) return;
  const { min, max } = dialBounds(settings, LIMITS.BRIGHTNESS, defaults);
  const step = dialStep(settings.step, 1, max - min, defaults.step, [1, 2, 5, 10, 25]);
  const raw = snap.brightness + dir * step;
  const next = bool(settings.wrap, defaults.wrap) ? wrap(raw, min, max) : clamp(raw, min, max, snap.brightness);
  try {
    await light.setBrightness(next);
  } catch (err) {
    report(err);
  }
}

/** Pressing the dial steps to the next preset, wrapping at the end. */
export async function onDialPress(ctx) {
  const { settings, light, snap, report } = ctx;
  const bounds = dialBounds(settings, LIMITS.BRIGHTNESS, defaults);
  const next = nextValueInList(settings, snap.brightness, defaults, bounds);
  if (next === null) return;
  try {
    await light.setBrightness(next);
  } catch (err) {
    report(err);
  }
}