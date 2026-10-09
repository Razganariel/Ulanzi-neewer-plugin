/**
 * Registry of the NEEWER fixtures the plugin drives.
 *
 * There is no cap on how many devices can be registered: each one owns a
 * `NeewerLight` session with its own BLE link, so a key press on one fixture
 * never queues behind another. The registry is the only owner of the list, and
 * it is what the property inspectors render as a "Device" picker.
 */

import { EventEmitter } from 'node:events';
import { NeewerLight } from './light.js';
import { NeewerTransport, normalizeAddress } from './ble.js';

let counter = 0;

function nextId() {
  counter += 1;
  return `light-${Date.now().toString(36)}-${counter}`;
}

function sanitize(device) {
  const address = normalizeAddress(device?.address);
  if (!address) return null;
  const name = String(device?.name || '').trim();
  return {
    id: String(device?.id || '').trim() || nextId(),
    address,
    name: name || 'Neewer light',
  };
}

export class DeviceRegistry extends EventEmitter {
  /**
   * @param {{save: (devices: object[], activeId: string) => void}} store
   * @param {{createLight?: (device: object) => NeewerLight}} [options]
   */
  constructor(store, options = {}) {
    super();
    this._store = store;
    // Injected so the registry can be exercised without a radio: a stub light
    // keeps the wiring testable while the real one owns the BLE link.
    this._create = options.createLight || ((device) => new NeewerLight(device));
    /** @type {Map<string, {id:string,address:string,name:string}>} */
    this.devices = new Map();
    /** @type {Map<string, NeewerLight>} */
    this.lights = new Map();
    this.activeId = '';
  }

  /**
   * Adopts a stored settings blob, migrating the single-address layout used
   * before multi-device support so an existing installation keeps its light.
   *
   * @param {object} settings
   */
  load(settings) {
    const raw = Array.isArray(settings?.devices) ? settings.devices : [];
    const list = raw.map(sanitize).filter(Boolean);
    if (!list.length) {
      const legacy = sanitize({ address: settings?.address, name: settings?.name });
      if (legacy) list.push(legacy);
    }
    for (const device of list) {
      this.devices.set(device.id, device);
      this.lights.set(device.id, this._createLight(device));
    }
    const wanted = String(settings?.activeId || '').trim();
    this.activeId = this.devices.has(wanted) ? wanted : list[0]?.id || '';
  }

  _createLight(device) {
    const light = this._create(device);
    // A fixture going up or down is interesting to every action bound to it, not
    // just the one that triggered the traffic.
    light.on('state', () => this.emit('change', { deviceId: device.id }));
    if (device.address) light.connect();
    return light;
  }

  /**
   * Discovery runs on its own throwaway transport: the advertisement watcher is
   * adapter-wide, so scanning must not tear down the links the other fixtures
   * are holding.
   *
   * @param {{duration?:number, onlyNeewer?:boolean}} opts
   */
  scan(opts) {
    return new NeewerTransport().scan(opts);
  }

  /**
   * @param {{address:string,name?:string,id?:string}} input
   * @returns {object} the stored device
   */
  add(input) {
    const candidate = sanitize(input);
    if (!candidate) throw new Error('A Neewer device needs a Bluetooth address');
    const existing = [...this.devices.values()].find(
      (device) => device.address === candidate.address
    );
    if (existing) {
      if (candidate.name && candidate.name !== existing.name) {
        existing.name = candidate.name;
        this._syncLight(existing);
      }
      this._persist();
      return existing;
    }
    this.devices.set(candidate.id, candidate);
    this.lights.set(candidate.id, this._createLight(candidate));
    if (!this.activeId) this.activeId = candidate.id;
    this._persist();
    this.emit('change', {});
    return candidate;
  }

  /**
   * @param {string} id
   * @returns {boolean} whether anything was removed
   */
  remove(id) {
    const device = this.devices.get(id);
    if (!device) return false;
    this.lights.get(id)?.stop();
    this.lights.delete(id);
    this.devices.delete(id);
    if (this.activeId === id) this.activeId = [...this.devices.keys()][0] || '';
    this._persist();
    this.emit('change', {});
    return true;
  }

  /**
   * @param {string} id
   * @param {string} address
   * @param {string} [name]
   */
  setAddress(id, address, name) {
    const device = this.devices.get(id);
    const next = normalizeAddress(address);
    if (!device || !next || device.address === next) return device || null;
    device.address = next;
    if (name) device.name = name;
    this._syncLight(device);
    this._persist();
    this.emit('change', { deviceId: id });
    return device;
  }

  /**
   * @param {string} id
   * @param {string} name
   * @returns {object|null}
   */
  rename(id, name) {
    const device = this.devices.get(id);
    const next = String(name || '').trim();
    if (!device || !next || device.name === next) return device || null;
    device.name = next;
    const light = this.lights.get(id);
    if (light) light.name = next;
    this._persist();
    this.emit('change', { deviceId: id });
    return device;
  }

  _syncLight(device) {
    const light = this.lights.get(device.id);
    if (!light) return;
    light.name = device.name;
    light.setAddress(device.address);
  }

  get(id) {
    if (!id) return null;
    return this.devices.get(id) || null;
  }

  /**
   * @param {string} [id]  falls back to the registry default
   * @returns {NeewerLight|null}
   */
  lightFor(id) {
    const key = this.devices.has(id) ? id : this.activeId;
    return this.lights.get(key) || null;
  }

  list() {
    return [...this.devices.values()].map((device) => ({ ...device }));
  }

  /**
   * State of every fixture, so an encoder can show the one it is bound to and
   * the action list can refresh them all in one pass.
   * @returns {Record<string, object>}
   */
  snapshots() {
    const out = {};
    for (const [id, light] of this.lights) {
      out[id] = { id, name: this.devices.get(id)?.name || light.name, ...light.snapshot() };
    }
    return out;
  }

  stopAll() {
    for (const light of this.lights.values()) light.stop();
  }

  _persist() {
    try {
      this._store.save(this.list(), this.activeId);
    } catch {
      /* the store reports its own failure; never break an action for it */
    }
  }
}
