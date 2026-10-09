/**
 * Saturation Down - one step less saturated per press. Clamped at 0, never
 * wrapped: see `saturation-up.js`.
 */

import { ACTION } from '../core/constants.js';
import { stepper } from './stepper.js';

export const { uuid, defaults, render, onRun } = stepper({
  uuid: ACTION.SATURATION_DOWN,
  title: (value) => `Saturation down (${value})`,
  sign: -1,
  step: 5,
  maxStep: 25,
  format: (snap) => `${snap.saturation}`,
  apply: (light, delta) => light.stepSaturation(delta),
});
