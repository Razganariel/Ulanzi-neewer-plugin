/**
 * CCT Presets inspector: which light to drive, and the scenes the key walks.
 *
 * The rows are packed back into the single `presets` string by the shared editor, so
 * the service still reads one flat "kelvin:brightness" list and nothing downstream
 * has to know the panel was split into fields.
 */

const editor = presetEditor({
  value: { label: 'Temperature', unit: 'K', min: 2500, max: 8500 },
  third: { label: 'Brightness', unit: '%', min: 1, max: 100 },
  title: 'brightness',
});

PI.boot('#property-inspector', {
  autoSave: false,
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
