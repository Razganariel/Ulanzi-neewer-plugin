/**
 * Hue Presets inspector: which light to drive, and the colour presets the key walks.
 *
 * The rows are packed back into the single `presets` string by the shared editor, so
 * the service still reads one flat "hue:saturation" list and nothing downstream has
 * to know the panel was split into fields.
 */

const editor = presetEditor({
  value: { label: 'Hue', unit: '°', min: 0, max: 359 },
  third: { label: 'Saturation', unit: '%', min: 0, max: 100 },
  title: 'saturation',
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
