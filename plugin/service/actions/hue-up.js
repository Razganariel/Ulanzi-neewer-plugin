/**
 * Hue Up - each press advances the hue by one step.
 *
 * Same shape as the brightness, saturation and CCT buttons: a dial can sweep, a
 * button can only nudge, so this exists because the Hue key could not be both.
 *
 * The hue wraps rather than clamping. A button that stopped at 359 degrees would
 * need a second press from the other end to come back, and the dial already wraps,
 * so the two would disagree about what "up" means at the seam.
 */

import { ACTION } from '../core/constants.js';
import { stepper } from './stepper.js';

export const { uuid, defaults, render, onRun } = stepper({
  uuid: ACTION.HUE_UP,
  sign: 1,
  step: 30,
  maxStep: 120,
  format: (snap) => `${Math.round(snap.hue)}`,
  // One argument: setHsl keeps whatever saturation and brightness are current.
  apply: (light, delta) => light.stepHue(delta),
});
