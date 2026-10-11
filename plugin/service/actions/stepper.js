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
import { setStateIconOnce, setTitle } from '../core/ui.js';

/**
 * Builds one button action that nudges a single field by a fixed step.
 *
 * The key is titled with the current value and nothing else. It used to be titled
 * `<name> up (<value>)`, which is long enough to be truncated on a small key and buries
 * the only part that changes: the level the button is about to move from.
 *
 * @param {object} spec
 * @param {string} spec.uuid    action uuid
 * @param {number} spec.sign    +1 for up, -1 for down
 * @param {number} spec.step    default step
 * @param {number} spec.maxStep highest step the inspector may offer
 * @param {(snap: object) => string} spec.format  the value shown on the key, unit included
 * @param {(light: object, delta: number) => Promise<void>} spec.apply
 * @param {number} [spec.quantum=1]  wire granularity a step is rounded onto
 * @param {(snap: object, delta: number) => boolean} [spec.settled]
 *        True when the move would land on the current value anyway, which lets a
 *        press at a bound skip the frame instead of resending it.
 */
export function stepper({ uuid, sign, step, maxStep, format, apply, quantum = 1, settled }) {
  return {
    uuid,

    defaults: { device: '', step },

    render({ $UD, context, snap }) {
      const value = format(snap);
      // Once per key. Every button declares a single state whose image never changes, and
      // resending it asked the host to repaint something identical - which is the frame
      // that can put the name of the state on the key for an instant.
      setStateIconOnce($UD, context, STATE.DEFAULT, value);
      setTitle($UD, context, value);
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
 * A press that changes nothing: the move is compared after clamping.
 *
 * From 8400 K a 200 K step overshoots 8500 K but still has to land on 8500 K, so the
 * light does move and the frame is worth sending. Only a press that is already sitting
 * on its bound is a no-op, and sending it anyway would make the lamp answer a key it
 * never really acted on.
 *
 * @param {string} field snapshot field the step moves
 * @param {number} min
 * @param {number} max
 * @returns {(snap: object, delta: number) => boolean}
 */
export function atBound(field, min, max) {
  return (snap, delta) => {
    const next = Math.min(max, Math.max(min, snap[field] + delta));
    return next === snap[field];
  };
}

/**
 * How the temperature is written on a key.
 *
 * Whatever mode the lamp is in. It used to read "HSL" in colour mode, so a Hue or
 * Saturation press wiped the level off the CCT keys and dials: a mode is not a level and
 * says nothing about the setting those keys are about. A colour command leaves the
 * remembered temperature alone, and the dials beside it show their value either way.
 *
 * @param {object} snap
 * @returns {string}
 */
export function formatCct(snap) {
  return `${snap.cct}K`;
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
