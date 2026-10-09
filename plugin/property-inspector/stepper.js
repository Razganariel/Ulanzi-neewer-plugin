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
    PI.boot('#property-inspector', {
      onState(state) {
        PI.status(PI.el('link'), state.connected ? 'connected' : state.connecting ? 'connecting' : 'disconnected');
        PI.setText('detail', `${state.name || 'Neewer'} ${state.address || '-'} - ${state[field]}${unit} - mode ${state.mode}`);
      },
      onRegistry({ devices, deviceId }) {
        PI.deviceSelect('device', devices, deviceId);
        PI.setText('device-hint', devices.length ? '' : 'No light registered yet - use the Neewer Scan action to add one.');
      },
      onError(message) {
        PI.showError('error', message);
      },
    });
  };
})();
