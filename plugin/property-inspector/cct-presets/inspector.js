/**
 * Scene list mirror for the CCT Presets action.
 *
 * The service reads `presets` as a flat "kelvin:brightness" string, which is a
 * poor thing to hand-edit. This table shows what the current string decodes to,
 * so a mistyped scene is visible here rather than as a wrong colour on the light.
 */

const MEASURED = [
  ['Candle', 3400, 28],
  ['Sunset', 4500, 16],
  ['Afternoon light', 5000, 16],
  ['Sunlight', 5600, 28],
  ['Cold blue light', 6500, 100],
];

function renderScenes(settings) {
  const body = PI.el('preset-table').querySelector('tbody');
  if (!body) return;
  const names = String(settings.presetNames ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const entries = String(settings.presets ?? '')
    .split(/[|,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [kelvin, brightness] = part.split(':');
      return { kelvin, brightness };
    });
  body.textContent = '';
  entries.forEach((entry, index) => {
    // The measured table is only a hint for the common case; the name always
    // comes from the settings so a user-renamed scene shows what they typed.
    const measured = MEASURED[index];
    const row = body.insertRow();
    row.insertCell().textContent = String(index + 1);
    row.insertCell().textContent = names[index] || measured?.[0] || `Scene ${index + 1}`;
    row.insertCell().textContent = `${entry.kelvin} K`;
    // A missing brightness is legal: it keeps whatever the dial had set.
    row.insertCell().textContent = entry.brightness !== undefined
      ? `${entry.brightness} %`
      : `current${measured ? ` (measured ${measured[2]} %)` : ''}`;
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
    renderScenes(settings);
  },
  onError(message) {
    PI.showError('error', message);
  },
});
