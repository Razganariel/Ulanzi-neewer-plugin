/**
 * Shared property inspector bootstrap: connects to UlanziStudio, hydrates the
 * form from saved settings, and pushes changes back to the main service.
 */
(function () {
  // A property inspector runs in a WebView with no console the user can reach, so
  // a thrown error is otherwise invisible: the panel just looks inert. Surface
  // failures in the page itself.
  //
  // The page also hosts code injected by UlanziStudio, which has its own startup
  // race: it sends on a socket that is still CONNECTING. Blaming the plugin for
  // that would send the user hunting in the wrong place, so it goes to the
  // console. Everything else, including our own bundled SDK, keeps the banner.
  const HOST_NOISE = /Still in CONNECTING state/;

  function reportFatal(what, err) {
    const message = `${what}: ${(err && err.message) || err}`;
    if (HOST_NOISE.test(message)) {
      console.warn(`[neewer] ignoré (hôte Ulanzi) : ${message}`);
      return;
    }
    let box = document.getElementById('pi-error');
    if (!box) {
      box = document.createElement('div');
      box.id = 'pi-error';
      box.style.cssText =
        'position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:8px 10px;' +
        'background:#7f1d1d;color:#fff;font:12px/1.4 monospace;white-space:pre-wrap';
      document.body.appendChild(box);
    }
    box.textContent = message;
  }
  window.addEventListener('error', (e) => reportFatal('JS error', e.error || e.message));

  function boot(formId, options) {
    const form = document.querySelector(formId);
    if (!form) {
      reportFatal('Form not found', formId);
      return null;
    }
    try {
      return bootForm(form, options);
    } catch (err) {
      reportFatal('Property inspector failed to start', err);
      throw err;
    }
  }

  function bootForm(form, options) {
    const sendParams = Utils.debounce((params) => $UD.sendParamFromPlugin(params), 150);

    $UD.connect(document.body.dataset.actionid);
    form.addEventListener('change', () => sendParams(Utils.getFormValue(form)));

    const applySettings = (settings) => {
      Utils.setFormValue(settings, form);
      // Mirrors of a raw settings string (the CCT scene list) need the value
      // after hydration, not just the fields the form knows how to draw.
      if (options.onSettings) options.onSettings(settings || {});
    };
    $UD.onParamFromApp((message) => applySettings(message.param));
    $UD.onDidReceiveSettings((message) => applySettings(message.settings));
    $UD.onSendToPropertyInspector((message) => {
      const payload = message.payload || {};
      if (payload.event === 'state' && options.onState) options.onState(payload.state);
      if (payload.event === 'state' && options.onRegistry) {
        options.onRegistry({ devices: payload.devices || [], activeId: payload.activeId, deviceId: payload.deviceId });
      }
      if (payload.event === 'scan-started' && options.onScanStarted) options.onScanStarted();
      if (payload.event === 'scan-result' && options.onScanResult) options.onScanResult(payload.devices || []);
      if (payload.event === 'scan-others' && options.onScanOthers) options.onScanOthers(payload.devices || []);
      if (payload.event === 'device-added' && options.onDeviceAdded) {
        options.onDeviceAdded(payload.device, payload.devices || []);
      }
      if (payload.event === 'device-removed' && options.onDeviceRemoved) {
        options.onDeviceRemoved(payload.deviceId, payload.devices || []);
      }
      if (payload.event === 'address-accepted' && options.onAddressAccepted) options.onAddressAccepted(payload.address);
      if (payload.event === 'error' && options.onError) options.onError(payload.message);
    });

    // Wait for WebSocket to be connected before requesting settings.
    // The connect() is async; calling getSettings() immediately fails because
    // the websocket isn't open yet ("object not usable" error).
    $UD.on('connected', () => {
      $UD.getSettings();
      // Also request the device registry (in case we missed the initial broadcast).
      $UD.sendToPlugin({ event: 'get-registry' });
    });

    return { form, sendParams };
  }

  window.PI = {
    el(id) {
      return document.getElementById(id);
    },
    on(id, event, fn) {
      const node = document.getElementById(id);
      if (node) node.addEventListener(event, fn);
      return node;
    },
    setText(id, text) {
      const node = document.getElementById(id);
      if (node) node.textContent = text;
    },
    showError(id, message) {
      const node = document.getElementById(id);
      if (!node) return;
      node.textContent = message || '';
      node.style.display = message ? 'block' : 'none';
    },
    /**
     * Fills a "Device" picker from the registry. The control carries name="device"
     * so the normal form handler persists the choice, but its options come from
     * the main service rather than from the saved settings, hence this helper.
     *
     * @param {string} id
     * @param {Array<{id:string,name:string,address:string}>} devices
     * @param {string} deviceId  the device this action is bound to
     */
    deviceSelect(id, devices, deviceId) {
      const select = document.getElementById(id);
      if (!select) return;
      const current = deviceId != null ? String(deviceId) : select.value;
      select.textContent = '';
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = devices.length ? 'Default device' : 'No device registered';
      select.appendChild(blank);
      for (const device of devices) {
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = device.name ? `${device.name} - ${device.address}` : device.address;
        select.appendChild(option);
      }
      // A stored id that is no longer registered would silently blank the picker.
      select.value = [...select.options].some((o) => o.value === current) ? current : '';
    },
    status(node, state) {
      if (!node) return;
      const dot = node.querySelector('.dot');
      const label = node.querySelector('.label');
      if (dot) dot.className = `dot ${state === 'connected' ? 'on' : state === 'error' ? 'off' : ''}`;
      if (label) label.textContent = state;
    },
    boot,
  };
})();
