/**
 * Hue Presets inspector: which light to drive, and the preset list the key walks.
 *
 * The service reads `presets` as a flat comma separated string of degrees, which
 * is a poor thing to hand-edit and easy to mistype. This table shows what the
 * current string decodes to, so a bad entry is visible here rather than as a
 * wrong colour on the light.
 */

function renderPresets(settings) {
  const body = PI.el('preset-table').querySelector('tbody');
  if (!body) return;
  const entries = String(settings.presets ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  body.textContent = '';
  entries.forEach((entry, index) => {
    const hue = Number(entry);
    const row = body.insertRow();
    row.insertCell().textContent = String(index + 1);
    // An entry that is not a number is shown as typed, so the mistake is readable
    // instead of being quietly dropped by the service.
    row.insertCell().textContent = Number.isFinite(hue) ? `${hue}°` : `${entry} (ignored)`;
  });
}

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
    renderPresets(settings);
  },
  onError(message) {
    PI.showError('error', message);
  },
});
