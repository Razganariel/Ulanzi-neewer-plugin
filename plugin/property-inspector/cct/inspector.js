/**
 * CCT dial inspector: which light to drive, the range to sweep, and the scenes a press
 * walks.
 *
 * The rows are packed back into the single `presets` string by the shared editor, so
 * the service still reads one flat "kelvin:brightness" list and nothing downstream has
 * to know the panel was split into fields. The step, range and wrap fields above keep
 * saving as they are edited; only the rows wait for their own button.
 *
 * This list belongs to the dial. The CCT Presets key carries its own.
 */

const editor = presetEditor({
  value: { label: 'Temperature', name: 'Scene', min: 2500, max: 8500 },
  third: { label: 'brightness', min: 1, max: 100 },
});

PI.boot('#property-inspector', {
  onState(state) {
    PI.status(PI.el('link'), state.connected ? 'connected' : state.connecting ? 'connecting' : 'disconnected');
    PI.setText('detail', `${state.name || 'Neewer'} ${state.address || '-'}`);
  },
  onRegistry({ devices, deviceId }) {
    PI.deviceSelect('device', devices, deviceId);
    PI.setText('device-hint', devices.length ? '' : 'No light registered yet - use the Neewer Scan action to add one.');
  },
  onSettings(settings) {
    editor.render(settings);
  },
  onError(message) {
    PI.showError('error', message);
  },
});
