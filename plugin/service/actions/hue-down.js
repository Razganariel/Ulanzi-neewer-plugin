/**
 * Hue Down - each press steps the hue back by one step. Wraps like `hue-up.js`.
 */

import { ACTION } from '../core/constants.js';
import { stepper } from './stepper.js';

export const { uuid, defaults, render, onRun } = stepper({
  uuid: ACTION.HUE_DOWN,
  title: (value) => `hue down (${value})`,
  sign: -1,
  step: 30,
  maxStep: 120,
  format: (snap) => `${Math.round(snap.hue)}`,
  apply: (light, delta) => light.stepHue(delta),
});
