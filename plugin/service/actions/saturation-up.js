/**
 * Saturation Up - one step more saturated per press.
 *
 * Saturation is a field of the 0x86 colour frame, not a command of its own, so
 * every step resends the whole colour; `stepSaturation` does that with the hue
 * currently on the light.
 */

import { ACTION } from '../core/constants.js';
import { stepper } from './stepper.js';

export const { uuid, defaults, render, onRun } = stepper({
  uuid: ACTION.SATURATION_UP,
  title: (value) => `Saturation up (${value})`,
  sign: 1,
  step: 5,
  maxStep: 25,
  format: (snap) => `${snap.saturation}`,
  apply: (light, delta) => light.stepSaturation(delta),
});
