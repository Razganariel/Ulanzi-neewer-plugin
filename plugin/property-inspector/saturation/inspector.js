/**
 * Saturation dial inspector: which light to drive, the range to sweep, and the values
 * a press steps through.
 *
 * The rows are packed back into the single `presets` string by the shared editor, so
 * the service still reads one flat list of numbers and nothing downstream has to know
 * the panel was split into fields. The range and step fields above keep saving as they
 * are edited; only the rows wait for their own button.
 */

const editor = presetEditor({
  value: { label: 'Saturation', name: 'Value', unit: '%', min: 0, max: 100 },
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
