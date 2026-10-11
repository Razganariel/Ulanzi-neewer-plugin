/**
 * Brightness Down - one step dimmer per press. Clamped, never wrapped: see
 * `brightness-up.js`.
 */

import { ACTION } from '../core/constants.js';
import { stepper } from './stepper.js';

export const { uuid, defaults, render, onRun } = stepper({
  uuid: ACTION.BRIGHTNESS_DOWN,
  sign: -1,
  step: 5,
  maxStep: 25,
  format: (snap) => `${snap.brightness}%`,
  apply: (light, delta) => light.stepBrightness(delta),
});
