PI.boot('#property-inspector', {
  onState(state) {
    PI.status(PI.el('link'), state.connected ? 'connected' : state.connecting ? 'connecting' : 'disconnected');
    const bits = [state.name || 'Neewer', state.address || 'no address'];
    if (state.connected) {
      bits.push(`${state.brightness}%`);
      bits.push(state.mode === 'cct' ? `${state.cct}K` : `hue ${state.hue}`);
    }
    if (state.lastError) bits.push(state.lastError);
    PI.setText('detail', bits.join(' - '));
  },
  onRegistry({ devices, deviceId }) {
    PI.deviceSelect('device', devices, deviceId);
    PI.setText('device-hint', devices.length ? '' : 'No light registered yet - use the Neewer Scan action to add one.');
  },
  onError(message) {
    PI.showError('error', message);
  },
});
