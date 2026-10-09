const form = PI.boot('#property-inspector', {
  onState(state) {
    PI.status(PI.el('link'), state.connected ? 'connected' : state.connecting ? 'connecting' : 'disconnected');
    PI.setText('detail', `${state.name || 'Neewer'} ${state.address || '-'} - ${state.brightness}%`);
    // Reached from `form` would throw: PI.boot() can deliver a state event
    // synchronously, before the `form` binding is initialised.
    const address = PI.el('address');
    if (address && document.activeElement !== address) address.value = state.address || '';
  },
  onRegistry({ devices, deviceId }) {
    PI.deviceSelect('device', devices, deviceId);
    renderRegistered(devices, deviceId);
  },
  onScanStarted() {
    PI.showError('error', '');
    const button = PI.el('scan');
    button.disabled = true;
    button.textContent = 'Scanning...';
  },
  onScanResult(devices) {
    const button = PI.el('scan');
    button.disabled = false;
    button.textContent = 'Scan';
    render(devices);
  },
  onScanOthers(devices) {
    // Fallback list: a lamp that advertises no name never matches the Neewer
    // filter, so show everything else that was in range and let it be picked.
    PI.setText('others-title', devices.length ? `Other devices in range (${devices.length})` : '');
    render(devices, PI.el('others'), 'Nothing else in range.');
  },
  onDeviceAdded(device) {
    PI.showError('error', '');
    PI.setText('picked', `${device.name || 'Device'} added - connecting...`);
  },
  onDeviceRemoved() {
    PI.showError('error', '');
  },
  onAddressAccepted(address) {
    PI.showError('error', '');
    PI.setText('picked', `${address} selected - connecting...`);
  },
  onError(message) {
    PI.showError('error', message);
    const button = PI.el('scan');
    button.disabled = false;
    button.textContent = 'Scan';
  },
});

/**
 * The list of lights the plugin knows about: rename, forget, and see which one a
 * control is bound to. Adding happens through the scan results below.
 */
function renderRegistered(devices, deviceId) {
  const body = PI.el('registered');
  body.textContent = '';
  PI.setText('registered-title', devices.length ? `Registered lights (${devices.length})` : '');
  if (!devices.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 3;
    cell.className = 'hint';
    cell.textContent = 'No light registered yet. Scan below, or type an address.';
    return;
  }
  for (const device of devices) {
    const row = body.insertRow();
    const name = row.insertCell();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'mono';
    input.value = device.name || '';
    input.addEventListener('change', () => {
      $UD.sendToPlugin({ event: 'rename-device', deviceId: device.id, name: input.value.trim() });
    });
    name.appendChild(input);
    row.insertCell().textContent = device.address;
    const actions = row.insertCell();
    actions.className = 'pick';
    if (device.id === deviceId) {
      const tag = document.createElement('span');
      tag.className = 'hint';
      tag.textContent = 'in use';
      actions.appendChild(tag);
    }
    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'ghost';
    forget.textContent = 'Forget';
    forget.addEventListener('click', () => {
      $UD.sendToPlugin({ event: 'remove-device', deviceId: device.id });
    });
    actions.appendChild(forget);
  }
}

function render(devices, body, emptyText) {
  body = body || PI.el('devices');
  body.textContent = '';
  if (!devices.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 4;
    cell.className = 'hint';
    cell.textContent = emptyText || 'Run a scan to list the Neewer lights in range.';
    return;
  }
  for (const device of devices) {
    const row = body.insertRow();
    row.insertCell().textContent = device.name;
    row.insertCell().textContent = device.address;
    row.insertCell().textContent = device.rssi == null ? '-' : `${device.rssi} dBm`;
    const cell = row.insertCell();
    cell.className = 'pick';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost';
    button.textContent = 'Add';
    button.addEventListener('click', () => addDevice(device.address, device.name));
    cell.appendChild(button);
  }
}

function addDevice(address, name) {
  $UD.sendToPlugin({ event: 'add-device', address, name: name || '', bind: true });
  PI.showError('error', '');
}

PI.on('scan', 'click', () => {
  const params = Utils.getFormValue(form.form);
  $UD.sendToPlugin({
    event: 'scan',
    duration: Number(params.duration) || 6,
    // The form field is `only`; the payload key is `onlyNeewer`, which is what the
    // service reads for this button. The two were once the same word and then were not.
    onlyNeewer: params.only !== 'false',
  });
});

PI.on('reconnect', 'click', () => $UD.sendToPlugin({ event: 'reconnect' }));

PI.on('apply', 'click', () => {
  addDevice(PI.el('address').value.trim().toUpperCase(), '');
});
