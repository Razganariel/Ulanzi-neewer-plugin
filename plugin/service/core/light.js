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

/**
 * The fields that make up the deck's belief about a fixture, and nothing else.
 *
 * Link status, the address and the name are not part of it: they describe the session,
 * not the last thing the user asked the lamp to do.
 */
export const COMMANDED_FIELDS = Object.freeze([
  'power',
  'brightness',
  'hue',
  'saturation',
  'cct',
  'mode',
]);

/**
 * Keeps only what a fixture can actually be driven to.
 *
 * The blob comes out of a settings file the host owns, so a hand edit or an older
 * layout must not be able to put a light into a state no action could ever produce.
 */
export function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const field of ['power', 'brightness', 'hue', 'saturation', 'cct']) {
    const n = Number(raw[field]);
    if (Number.isFinite(n)) out[field] = field === 'power' ? n !== 0 : n;
  }
  if (raw.mode === 'hsl' || raw.mode === 'cct') out.mode = raw.mode;
  return out;
}

export class NeewerLight extends EventEmitter {
  /**
   * @param {{address?:string, name?:string}} [device]
   * @param {object} [initialState] last commanded state of a previous session
   * @param {NeewerTransport} [transport] injected so a test can drive the link
   *        lifecycle without spawning the native helper
   */
  constructor(device = {}, initialState = null, transport = null) {
    super();
    this.transport = transport || new NeewerTransport();
    // Armed here rather than on the first write: the fixture reports its own state the
    // moment the link comes up, and waiting for a write meant that frame was dropped.
    this.transport.onFrame = (data) => this._onNotify(data);
    this.address = normalizeAddress(device.address);
    this.name = device.name || '';
    this.connected = false;
    this.connecting = false;
    this.lastError = '';
    this.state = {
      power: DEFAULTS.POWER,
      mode: DEFAULTS.MODE,
      brightness: DEFAULTS.BRIGHTNESS,
      hue: DEFAULTS.HUE,
      saturation: DEFAULTS.SATURATION,
      cct: DEFAULTS.CCT,
      // Restored from what the deck was last told to do.
      //
      // This fixture cannot be read: it has no read command, its one voluntary frame
      // carries a constant level that measures 100 whether the lamp is lit or not, and
      // changing it with its own buttons produces no notification. So the last command
      // is the only honest value available at startup. It is this session's intent, not
      // a measurement - the deck will say 50% for a lamp someone dimmed by hand.
      ...sanitizeState(initialState),
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
      // Nothing is written on connect, deliberately. Every frame this protocol has is
      // a command: a colour frame switches the lamp on, a power frame switches it off.
      // Re-asserting the cached state here therefore imposes a state instead of
      // observing one, which is how starting UlanziDeck with the lamp already on
      // used to turn it off.
      //
      // The truth arrives without the plugin having to speak first: the fixture
      // volunteers OP 0x05 the moment the link comes up (see `_onNotify`), and
      // nlink has already subscribed to notifications by the time `open` returns.
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

  async _send(frame, patch = true) {
    await this.transport.write(frame);
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
