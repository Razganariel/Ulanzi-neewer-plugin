/**
 * Hue dial inspector: which light to drive, the step a rotation takes, and the colours
 * a press walks.
 *
 * The rows are packed back into the single `presets` string by the shared editor, so
 * the service still reads one flat "hue:saturation" list and nothing downstream has to
 * know the panel was split into fields. The step field above keeps saving as it is
 * edited; only the rows wait for their own button.
 *
 * This list belongs to the dial. The Hue Presets key carries its own.
 */

const editor = presetEditor({
  value: { label: 'Hue', name: 'Colour', min: 0, max: 359 },
  third: { label: 'saturation', min: 0, max: 100 },
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
