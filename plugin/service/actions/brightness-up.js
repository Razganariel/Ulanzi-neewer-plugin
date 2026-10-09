/**
 * Brightness Up - one step brighter per press.
 *
 * Clamped rather than wrapped: a button that jumped from 100% back to 1% would
 * read as a glitch. The dial (`brightness.js`) is the one that wraps.
 */

import { ACTION } from '../core/constants.js';
import { stepper } from './stepper.js';

export const { uuid, defaults, render, onRun } = stepper({
  uuid: ACTION.BRIGHTNESS_UP,
  title: (value) => `Brightness up (${value}%)`,
  sign: 1,
  step: 5,
  maxStep: 25,
  format: (snap) => `${snap.brightness}%`,
  apply: (light, delta) => light.stepBrightness(delta),
});
