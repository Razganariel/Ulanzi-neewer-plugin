/**
 * Shared body for the four one-step button inspectors (brightness/saturation up
 * and down).
 *
 * The dials keep the range and wrap settings they need for continuous sweeping;
 * a button only moves one step, so a step choice is all it needs.
 */

(function () {
  /**
   * @param {object} spec
   * @param {string} spec.field    snapshot field shown in the status line
   * @param {string} spec.unit     unit appended to that field
   * @param {string} spec.summary  subtitle under the title
   */
  window.STEPPER_PI = function bootStepper({ field, unit, summary }) {
    document.querySelector('p.sub').textContent = summary;
    PI.panel({
      detail: (state) =>
        `${state.name || 'Neewer'} ${state.address || '-'} - ${state[field]}${unit} - mode ${state.mode}`,
    });
  };
})();
