PI.panel({
  detail(state) {
    const bits = [state.name || 'Neewer', state.address || 'no address'];
    if (state.connected) {
      bits.push(`${state.brightness}%`);
      bits.push(state.mode === 'cct' ? `${state.cct}K` : `hue ${state.hue}`);
    }
    if (state.lastError) bits.push(state.lastError);
    return bits.join(' - ');
  },
});
