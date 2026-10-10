/**
 * CCT Step Down - each press lowers the colour temperature by one step.
 *
 * Same shape as the brightness and saturation buttons: a dial can sweep, a button
 * can only nudge, so this exists because the CCT key could not be both.
 *
 * Lowering kelvin moves towards the warm end. Clamped, never wrapped: a press that
 * jumped from 2500 K back to 8500 K would read as a glitch, and the dial is the one
 * that wraps.
 */

import { ACTION, LIMITS } from '../core/constants.js';
import { stepper } from './stepper.js';

/** The frame carries one byte of 100 K, so nothing finer can be expressed. */
const QUANTUM = 100;

/**
 * True when the press would change nothing.
 *
 * The move is compared after clamping, not before: from 8400 K a 200 K step
 * overshoots 8500 K but still has to land on 8500 K, so the light does move and
 * the frame is worth sending. Only a press that is already sitting on its bound
 * is a no-op.
 */
const atBound = (snap, delta) => {
  const next = Math.min(LIMITS.CCT.max, Math.max(LIMITS.CCT.min, snap.cct + delta));
  return next === snap.cct;
};

export const { uuid, defaults, render, onRun } = stepper({
  uuid: ACTION.CCT_DOWN,
  title: (value) => `CCT down (${value})`,
  sign: -1,
  step: 200,
  maxStep: 1000,
  quantum: QUANTUM,
  format: (snap) => (snap.mode === 'cct' ? `${snap.cct}K` : 'HSL'),
  settled: atBound,
  // One argument: setCct keeps whatever brightness the dial or a scene left.
  apply: (light, delta) => light.stepCct(delta),
});
