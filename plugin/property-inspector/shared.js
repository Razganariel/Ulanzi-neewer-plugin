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

  /** The one form this panel owns, and how its settings reach the service. */
  let activeForm = null;
  let repack = null;
  let sendParams = () => {};

  /**
   * Strips the per-row preset inputs so they are never persisted as settings.
   *
   * Their names are positional (`p0_name`, `p1_value`, ...), so they turn up in every read
   * of the form. The preset editor strips them on its own Save; this is the same rule on
   * the automatic path, which is where they used to leak into the action's settings and
   * stay there, since deleting a row only ever lowers the highest index.
   *
   * @param {object} settings
   * @returns {object} a copy without the row fields
   */
  function withoutRowFields(settings) {
    const out = { ...settings };
    for (const key of Object.keys(out)) {
      if (/^p\d+_(name|value|third)$/.test(key)) delete out[key];
    }
    return out;
  }

  function bootForm(form, options) {
    sendParams = Utils.debounce((params) => $UD.sendParamFromPlugin(params), 150);
    activeForm = form;
    repack = options.repack || null;

    $UD.connect(document.body.dataset.actionid);

    // Enter inside a text field submits the form, and a submitted form in a WebView
    // navigates, which loses the panel and everything typed into it. Nothing here is
    // ever submitted; the save buttons do it explicitly.
    form.addEventListener('submit', (event) => event.preventDefault());

    const collect = () => {
      const raw = Utils.getFormValue(form);
      // The preset rows live inside the form and are named after their position, so a
      // plain read collects them. Saving one of them here wrote `p0_name`, `p0_value` and
      // friends into the action's settings, where they were merged and stored: junk keys
      // that nothing ever read and that were never removed, since deleting a row only ever
      // lowers the highest index. The editor's own Save had been stripping them; this is
      // the same rule applied to every automatic save.
      return repack ? repack(withoutRowFields(raw)) : withoutRowFields(raw);
    };

    // Panels that are nothing but a preset list opt out of automatic saving wholly.
    // The others keep saving as they are edited, with one exception: the preset table
    // is saved by its own buttons, and writing a half typed row on every blur is
    // exactly what those buttons exist to prevent.
    if (options.autoSave !== false) {
      form.addEventListener('change', (event) => {
        if (inPresetTable(event.target)) return;
        sendParams(collect());
      });
    }

    const applySettings = (settings) => {
      Utils.setFormValue(settings, form);
      // Mirrors of a raw settings string (the CCT scene list, the preset rows) need
      // the value after hydration, not just the fields the form knows how to draw.
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

  /**
   * Whether a change came from the preset table rather than from a setting of the
   * panel itself.
   *
   * The dial panels hold both: their range and step fields save as they are edited,
   * while the preset rows only ever save when their own button is pressed.
   */
  function inPresetTable(node) {
    for (let el = node; el && el !== document.body; el = el.parentElement) {
      if (el.classList && el.classList.contains('presets')) return true;
    }
    return false;
  }

  window.PI = {
    el(id) {
      return document.getElementById(id);
    },
    /**
     * The settings the form currently describes, reshaped by the inspector.
     *
     * @returns {object}
     */
    read() {
      const raw = activeForm ? Utils.getFormValue(activeForm) : {};
      return repack ? repack(raw) : raw;
    },
    /**
     * Hands settings to the main service, on an explicit press.
     *
     * Not debounced, and not sharing the automatic path's timer. That timer exists to
     * coalesce a burst of edits, but a Save is one deliberate act: sharing the timer meant
     * a Save followed by any other change inside 150 ms was dropped, and the row it saved
     * was lost with nothing said anywhere.
     */
    push(settings) {
      $UD.sendParamFromPlugin(settings);
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
