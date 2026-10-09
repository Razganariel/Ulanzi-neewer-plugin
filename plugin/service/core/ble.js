/**
 * BLE transport: discovery, connection lifecycle and the write queue.
 *
 * The radio is reached through `native/nlink.exe`, a C++/WinRT helper shipped
 * with the plugin, so nothing here depends on an npm native addon. Windows can
 * open a paired fixture straight from its address, which is why no
 * advertisement hunt is needed any more.
 *
 * The helper is started lazily: a missing or unusable helper degrades to a
 * reported error instead of taking the whole main service down.
 */

import { EventEmitter } from 'node:events';
import { NAME_HINTS, WRITE_GAP_MS } from './constants.js';
import { NativeLink } from './native.js';

export function normalizeAddress(address) {
  return String(address || '')
    .trim()
    .toUpperCase();
}

export function isNeewerName(name) {
  const upper = String(name || '').toUpperCase();
  return NAME_HINTS.some((hint) => upper.startsWith(hint));
}

/**
 * @typedef {object} ScanEntry
 * @property {string} address
 * @property {string} name
 */

export class NeewerTransport extends EventEmitter {
  constructor() {
    super();
    this.link = null;
    this.address = null;
    this.name = '';
    this.connected = false;
    this._queue = Promise.resolve();
    this._lastWrite = 0;
    /**
     * Owner's frame handler, armed for the whole life of the link.
     *
     * It used to be installed by `write`, which meant nothing could be heard before the
     * first write. That is exactly the wrong way round for this fixture: it volunteers
     * its state the moment the link comes up, so the one frame that could tell us the
     * lamp is on or off was always dropped on the floor.
     *
     * @type {((data: Buffer) => void) | null}
     */
    this.onFrame = null;
  }

  async ready() {
    if (!this.link) {
      const link = new NativeLink();
      link.on('notify', (address, data) => {
        if (this.onFrame && normalizeAddress(address) === normalizeAddress(this.address)) {
          this.onFrame(data);
        }
      });
      link.on('link', (up, reason) => {
        if (up) return;
        if (this.connected) this.emit('link', false, reason);
      });
      await link.start();
      this.link = link;
    }
    return this.link;
  }

  /**
   * @param {object} opts
   * @param {number} opts.duration      scan window in ms
   * @param {boolean} opts.onlyNeewer  keep only devices whose name matches a Neewer pattern
   * @returns {Promise<Array<ScanEntry>>}
   */
  async scan({ duration = 6000, onlyNeewer = true } = {}) {
    const link = await this.ready();
    const found = await link.scan(duration);
    return found
      .map((entry) => ({
        address: normalizeAddress(entry.address),
        name: entry.name,
        rssi: Number.isFinite(entry.rssi) ? entry.rssi : null,
      }))
      .filter((entry) => (onlyNeewer ? isNeewerName(entry.name) : true))
      .sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
  }

  /**
   * @param {string} address
   * @returns {Promise<{address:string,name:string}>}
   */
  async connect(address) {
    const target = normalizeAddress(address);
    if (this.connected && normalizeAddress(this.address) === target) {
      return { address: target, name: this.name };
    }
    await this.disconnect();

    const link = await this.ready();
    let opened;
    try {
      opened = await link.open(target);
    } catch (err) {
      throw new Error(`Neewer device ${target} not reachable: ${err.message}`);
    }

    this.address = normalizeAddress(opened.address) || target;
    this.name = opened.name || '';
    this.connected = true;
    this.emit('link', true, this.address);
    return { address: this.address, name: this.name };
  }

  /**
   * @param {Buffer} frame
   */
  async write(frame) {
    const run = async () => {
      if (!this.connected || !this.address) throw new Error('Neewer device is not connected');

      const wait = WRITE_GAP_MS - (Date.now() - this._lastWrite);
      if (wait > 0) await sleep(wait);
      this._lastWrite = Date.now();

      const link = await this.ready();
      await link.write(this.address, frame);
    };

    this._queue = this._queue.then(run, run);
    return this._queue;
  }

  async disconnect() {
    const link = this.link;
    const address = this.address;
    this.connected = false;
    this.address = null;
    this.name = '';
    if (link && address) {
      try {
        await link.close(address);
      } catch {
        /* helper may already be gone */
      }
    }
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}