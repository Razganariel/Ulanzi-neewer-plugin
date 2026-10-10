/**
 * CCT Step Up - each press raises the colour temperature by one step.
 *
 * Same shape as the brightness and saturation buttons: a dial can sweep, a button
 * can only nudge, so this exists because the CCT key could not be both.
 *
 * Raising kelvin moves towards the cool end. Clamped, never wrapped: a press that
 * jumped from 8500 K back to 2500 K would read as a glitch, and the dial is the one
 * that wraps.
 */

import { ACTION, LIMITS } from '../core/constants.js';
import { atBound, stepper } from './stepper.js';

/** The frame carries one byte of 100 K, so nothing finer can be expressed. */
const QUANTUM = 100;

export const { uuid, defaults, render, onRun } = stepper({
  uuid: ACTION.CCT_UP,
  title: (value) => `CCT up (${value})`,
  sign: 1,
  step: 200,
  maxStep: 1000,
  quantum: QUANTUM,
  format: (snap) => (snap.mode === 'cct' ? `${snap.cct}K` : 'HSL'),
  settled: atBound('cct', LIMITS.CCT.min, LIMITS.CCT.max),
  // One argument: setCct keeps whatever brightness the dial or a scene left.
  apply: (light, delta) => light.stepCct(delta),
});
