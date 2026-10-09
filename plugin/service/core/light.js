/**
 * One RGB62 session, owned by a single entry of the device registry.
 *
 * Owns the BLE link, the cached fixture state and the reconnect supervisor.
 * Every action bound to this device goes through this instance, so a key press
 * never races another key press on the radio.
 */

import { EventEmitter } from 'node:events';
import { NeewerTransport, normalizeAddress } from './ble.js';
import {
  brightnessFrame,
  cctFrame,
  hslFrame,
  normalizeBrightness,
  normalizeCct,
  normalizeHue,
  normalizeSaturation,
  parseNotification,
  powerFrame,
} from './protocol.js';
import { DEFAULTS, RECONNECT_DELAYS_MS, RECONNECT_GIVE_UP_AFTER, RECONNECT_IDLE_MS } from './constants.js';

export class NeewerLight extends EventEmitter {
  /**
   * @param {{address?:string, name?:string}} [device]
   */
  constructor(device = {}) {
    super();
    this.transport = new NeewerTransport();
    this.address = normalizeAddress(device.address);
    this.name = device.name || '';
    this.connected = false;
    this.connecting = false;
    this.lastError = '';
    this.state = {
      power: true,
      mode: DEFAULTS.MODE,
      brightness: DEFAULTS.BRIGHTNESS,
      hue: DEFAULTS.HUE,
      saturation: DEFAULTS.SATURATION,
      cct: DEFAULTS.CCT,
    };
    this._reconnectAttempt = 0;
    // A light built with an address is live: the registry starts the first
    // connection right after construction.
    this._stopped = !this.address;

    // The radio is the only source of truth for an unexpected drop: mirror it
    // into the shared state and let the supervisor bring the link back.
    this.transport.on('link', (up) => {
      if (up) return;
      this._setLink({ connected: false, connecting: false, error: '' });
      this._scheduleReconnect();
    });
  }

  snapshot() {
    return {
      address: this.address,
      name: this.name,
      connected: this.connected,
      connecting: this.connecting,
      lastError: this.lastError,
      ...this.state,
    };
  }

  _patch(partial) {
    let changed = false;
    for (const [key, value] of Object.entries(partial)) {
      if (this.state[key] !== value) {
        this.state[key] = value;
        changed = true;
      }
    }
    if (changed) this.emit('state', this.snapshot());
  }

  _setLink({ connected, connecting = false, error = '' }) {
    const changed = this.connected !== connected || this.connecting !== connecting || this.lastError !== error;
    this.connected = connected;
    this.connecting = connecting;
    this.lastError = error;
    if (changed) this.emit('state', this.snapshot());
  }

  setAddress(address) {
    const next = normalizeAddress(address);
    if (next === this.address) return;
    this.address = next;
    this._reconnectAttempt = 0;
    if (!next) {
      this._stopped = true;
      this.transport.disconnect();
      this._setLink({ connected: false });
      return;
    }
    this._stopped = false;
    this._reconnectAttempt = 0;
    this.connect();
  }

  async connect() {
    if (!this.address || this.connecting) return;
    this._stopped = false;
    this._setLink({ connected: this.connected, connecting: true, error: '' });
    try {
      const info = await this.transport.connect(this.address);
      this.name = info.name || this.name;
      this._reconnectAttempt = 0;
      this._setLink({ connected: true, connecting: false, error: '' });
      // Push the cached state so the fixture matches what the keys display. An
      // off lamp is re-asserted explicitly, a colour frame would turn it on.
      if (this.state.power) await this._send(this._activeFrame(), false);
      else await this._send(powerFrame(false), false);
    } catch (err) {
      this._setLink({ connected: false, connecting: false, error: err.message });
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this._stopped || !this.address) return;
    // A fixture that has refused every attempt is left alone: the radio belongs
    // to the other lamps, and a permanent retry loop starves manual scans.
    if (this._reconnectAttempt >= RECONNECT_GIVE_UP_AFTER) {
      const timer = setTimeout(() => {
        if (!this._stopped) this.connect();
      }, RECONNECT_IDLE_MS);
      if (typeof timer.unref === 'function') timer.unref();
      return;
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(this._reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this._reconnectAttempt += 1;
    setTimeout(() => {
      if (!this._stopped) this.connect();
    }, delay);
  }

  _activeFrame() {
    return brightnessFrame(this.state.mode, this.state);
  }

  async _send(frame, patch = true) {
    await this.transport.write(frame, (data) => this._onNotify(data));
    if (patch) {
      const next = { power: true };
      if (frame[1] === 0x86) next.mode = 'hsl';
      if (frame[1] === 0x87) next.mode = 'cct';
      this._patch(next);
    }
    this.emit('sent', frame);
  }

  _onNotify(data) {
    const decoded = parseNotification(data);
    if (!decoded) return;
    if (decoded.kind === 'power') this._patch({ power: decoded.on });
    if (decoded.kind === 'hsl') {
      this._patch({
        power: true,
        mode: 'hsl',
        hue: decoded.hue,
        saturation: decoded.saturation,
        brightness: decoded.brightness,
      });
    }
    if (decoded.kind === 'cct') {
      this._patch({ power: true, mode: 'cct', cct: decoded.cct, brightness: decoded.brightness });
    }
  }

  /**
   * User-driven connection attempt: clears the backoff so a key press always
   * gets a real try, even after the supervisor gave up.
   */
  retry() {
    this._reconnectAttempt = 0;
    return this.connect();
  }

  async _guard(fn) {
    if (!this.address) throw new Error('No Neewer device configured - run the "Scan" action or set the address manually');
    if (!this.connected) {
      this.retry();
      throw new Error('Neewer device is not connected yet, retry in a moment');
    }
    return fn();
  }

  async setPower(on) {
    return this._guard(async () => {
      await this._send(powerFrame(on), false);
      this._patch({ power: on });
    });
  }

  async togglePower() {
    return this.setPower(!this.state.power);
  }

  async setBrightness(value) {
    const brightness = normalizeBrightness(value);
    return this._guard(async () => {
      await this._send(brightnessFrame(this.state.mode, { ...this.state, brightness }), false);
      this._patch({ power: true, brightness });
    });
  }

  async stepBrightness(delta) {
    return this.setBrightness(this.state.brightness + delta);
  }

  async setHsl(hue, saturation = this.state.saturation, brightness = this.state.brightness) {
    const next = {
      hue: normalizeHue(hue),
      saturation: normalizeSaturation(saturation),
      brightness: normalizeBrightness(brightness),
    };
    return this._guard(async () => {
      await this._send(hslFrame(next.hue, next.saturation, next.brightness), false);
      this._patch({ power: true, mode: 'hsl', ...next });
    });
  }

  async stepHue(delta) {
    return this.setHsl(this.state.hue + delta);
  }

  /**
   * Saturation is a field of the 0x86 frame, not a separate command: changing it
   * means resending the whole colour, which is why this exists at all. The
   * measured scale is a plain 0-100 (verified on a RGB62 on 2026-09-30).
   */
  async setSaturation(value) {
    return this.setHsl(this.state.hue, value);
  }

  async stepSaturation(delta) {
    return this.setHsl(this.state.hue, this.state.saturation + delta);
  }

  async setCct(kelvin, brightness = this.state.brightness) {
    const next = { cct: normalizeCct(kelvin), brightness: normalizeBrightness(brightness) };
    return this._guard(async () => {
      await this._send(cctFrame(next.cct, next.brightness), false);
      this._patch({ power: true, mode: 'cct', ...next });
    });
  }

  async stepCct(delta) {
    return this.setCct(this.state.cct + delta);
  }

  async reconnect() {
    this._stopped = false;
    this._reconnectAttempt = 0;
    await this.transport.disconnect();
    this._setLink({ connected: false });
    await this.connect();
  }

  stop() {
    this._stopped = true;
    this.transport.disconnect();
  }
}
