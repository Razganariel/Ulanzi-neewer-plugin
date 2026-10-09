/**
 * Shared body for the one-step button actions (brightness/saturation up and
 * down).
 *
 * A dial keeps a continuous, bidirectional control, so it does not need these:
 * `brightness.js` and `saturation.js` serve the dials. What a button cannot do
 * is sweep, so each press moves one step and stops.
 *
 * Every step goes through `light`, never through a cached local value: a dial may
 * have moved the fixture since the press, and `light.state` is the only copy that
 * is still true.
 */

import { STATE } from '../core/constants.js';
import { setStateIcon, setTitle } from '../core/ui.js';

/**
 * Builds one button action that nudges a single field by a fixed step.
 *
 * @param {object} spec
 * @param {string} spec.uuid    action uuid
 * @param {string} spec.title   key title, receives the formatted current value
 * @param {number} spec.sign    +1 for up, -1 for down
 * @param {number} spec.step    default step
 * @param {number} spec.maxStep highest step the inspector may offer
 * @param {(snap: object) => string} spec.format  value shown on the key
 * @param {(light: object, delta: number) => Promise<void>} spec.apply
 * @param {number} [spec.quantum=1]  wire granularity a step is rounded onto
 * @param {(snap: object, delta: number) => boolean} [spec.settled]
 *        True when the move would land on the current value anyway, which lets a
 *        press at a bound skip the frame instead of resending it.
 */
export function stepper({ uuid, title, sign, step, maxStep, format, apply, quantum = 1, settled }) {
  return {
    uuid,

    defaults: { device: '', step },

    render({ $UD, context, snap }) {
      const value = format(snap);
      setStateIcon($UD, context, STATE.DEFAULT, value);
      setTitle($UD, context, title(value));
    },

    async onRun(ctx) {
      const { settings, light, snap, report } = ctx;
      const delta = sign * stepSize(settings.step, step, maxStep, quantum);
      if (settled?.(snap, delta)) return;
      try {
        await apply(light, delta);
      } catch (err) {
        report(err);
      }
    },
  };
}

/**
 * A step is stored as a string by the inspector, and may arrive unset or junk.
 *
 * `quantum` is the wire granularity: colour temperature travels in one byte of
 * 100 K, so an off-grid step would be rounded by the protocol anyway. Rounding
 * here keeps the readout and the light in agreement.
 */
function stepSize(raw, fallback, maxStep, quantum) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const onGrid = quantum > 1 ? Math.round(n / quantum) * quantum : Math.round(n);
  if (onGrid < quantum) return fallback;
  return Math.min(maxStep, Math.max(quantum, onGrid));
}
