/**
 * Device registry behaviour: the piece that decides how many Neewer lights the
 * plugin can drive and how an action instance picks one of them. The BLE link is
 * stubbed so the tests stay offline.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceRegistry } from '../plugin/service/core/devices.js';

/** Records what would have been written to the host settings. */
function makeStore() {
  const writes = [];
  return {
    writes,
    save(devices, activeId) {
      writes.push({ devices: JSON.parse(JSON.stringify(devices)), activeId });
    },
  };
}

/**
 * Stand-in for NeewerLight: same surface, no radio. A real light would open a
 * BLE link as soon as the registry creates it, which is exactly what these
 * tests must not do.
 */
class StubLight {
  constructor(device) {
    this.listeners = new Map();
    this.address = String(device.address || '').toUpperCase();
    this.name = device.name || '';
    this.connected = false;
    this.connecting = false;
    this.lastError = '';
    this.state = { power: true, mode: 'hsl', brightness: 100, hue: 0, saturation: 100, cct: 5600 };
    this.connects = 0;
  }
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }
  emit(event, payload) {
    for (const fn of this.listeners.get(event) || []) fn(payload);
  }
  connect() {
    this.connects += 1;
  }
  setAddress(address) {
    this.address = String(address || '').toUpperCase();
  }
  stop() {}
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
}

function makeRegistry() {
  const store = makeStore();
  const registry = new DeviceRegistry({ save: store.save }, { createLight: (d) => new StubLight(d) });
  return { registry, store };
}

test('registers an unlimited number of devices', () => {
  const { registry } = makeRegistry();
  for (let i = 0; i < 12; i += 1) {
    registry.add({ address: `AA:BB:CC:00:00:${i.toString(16).padStart(2, '0')}`, name: `Light ${i}` });
  }
  assert.equal(registry.devices.size, 12);
  assert.equal(registry.list().length, 12);
});

test('each device gets its own light session', () => {
  const { registry } = makeRegistry();
  const a = registry.add({ address: 'AA:AA:AA:AA:AA:AA', name: 'A' });
  const b = registry.add({ address: 'BB:BB:BB:BB:BB:BB', name: 'B' });
  const lightA = registry.lightFor(a.id);
  const lightB = registry.lightFor(b.id);
  assert.notEqual(lightA, lightB);
  assert.equal(lightA.address, 'AA:AA:AA:AA:AA:AA');
  assert.equal(lightB.address, 'BB:BB:BB:BB:BB:BB');
});

test('lightFor falls back to the default device when a binding is stale', () => {
  const { registry } = makeRegistry();
  const first = registry.add({ address: 'AA:AA:AA:AA:AA:01', name: 'First' });
  registry.add({ address: 'AA:AA:AA:AA:AA:02', name: 'Second' });
  assert.equal(registry.activeId, first.id, 'the first device registered is the default');
  assert.equal(registry.lightFor('device-that-was-removed').name, 'First');
  assert.equal(registry.lightFor(first.id).name, 'First');
});

test('a device starts connecting as soon as it is registered', () => {
  const { registry } = makeRegistry();
  const device = registry.add({ address: 'AA:AA:AA:AA:AA:01' });
  assert.equal(registry.lightFor(device.id).connects, 1);
  registry.add({ address: 'AA:AA:AA:AA:AA:02' });
  assert.equal(registry.lightFor('').connects, 1, 'each light connects on its own');
});

test('the same address is never registered twice', () => {
  const { registry } = makeRegistry();
  const a = registry.add({ address: 'AA:AA:AA:AA:AA:AA', name: 'Key light' });
  const b = registry.add({ address: 'aa:aa:aa:aa:aa:aa', name: 'Renamed' });
  assert.equal(registry.devices.size, 1);
  assert.equal(a.id, b.id);
  assert.equal(registry.get(a.id).name, 'Renamed', 'a re-scan refreshes the name');
});

test('removing the default device promotes another one', () => {
  const { registry } = makeRegistry();
  const a = registry.add({ address: 'AA:AA:AA:AA:AA:01' });
  const b = registry.add({ address: 'AA:AA:AA:AA:AA:02' });
  assert.equal(registry.activeId, a.id);
  assert.equal(registry.remove(a.id), true);
  assert.equal(registry.activeId, b.id);
  assert.equal(registry.remove(a.id), false, 'removing twice is a no-op');
});

test('removing the last device leaves nothing to fall back on', () => {
  const { registry } = makeRegistry();
  const a = registry.add({ address: 'AA:AA:AA:AA:AA:01' });
  registry.remove(a.id);
  assert.equal(registry.activeId, '');
  assert.equal(registry.lightFor(''), null);
});

test('a device without an address is refused', () => {
  const { registry } = makeRegistry();
  assert.throws(() => registry.add({ name: 'nameless' }), /address/i);
  assert.throws(() => registry.add({ address: '   ' }), /address/i);
});

test('addresses are normalised so lookups match', () => {
  const { registry } = makeRegistry();
  const device = registry.add({ address: '  f4:9f:7f:53:f0:b8 ', name: 'RGB62' });
  assert.equal(device.address, 'F4:9F:7F:53:F0:B8');
  assert.equal(registry.get(device.id).address, 'F4:9F:7F:53:F0:B8');
});

test('load migrates the old single-address settings', () => {
  const { registry } = makeRegistry();
  registry.load({ address: 'f4:9f:7f:53:f0:b8', name: 'NEEWER-RGB62' });
  assert.equal(registry.devices.size, 1);
  const device = registry.list()[0];
  assert.equal(device.address, 'F4:9F:7F:53:F0:B8');
  assert.equal(device.name, 'NEEWER-RGB62');
  assert.equal(registry.activeId, device.id);
});

test('load keeps a multi-device list and its default', () => {
  const { registry } = makeRegistry();
  registry.load({
    address: 'AA:AA:AA:AA:AA:AA',
    devices: [
      { id: 'one', address: 'AA:AA:AA:AA:AA:01', name: 'Key' },
      { id: 'two', address: 'AA:AA:AA:AA:AA:02', name: 'Fill' },
    ],
    activeId: 'two',
  });
  assert.equal(registry.devices.size, 2, 'the device list wins over the legacy address');
  assert.equal(registry.activeId, 'two');
  assert.equal(registry.lightFor('').name, 'Fill');
});

test('load ignores entries without an address instead of failing', () => {
  const { registry } = makeRegistry();
  registry.load({ devices: [{ id: 'ok', address: 'AA:AA:AA:AA:AA:01' }, { id: 'broken' }, null] });
  assert.equal(registry.devices.size, 1);
});

test('renaming keeps the address and the id', () => {
  const { registry } = makeRegistry();
  const device = registry.add({ address: 'AA:AA:AA:AA:AA:01', name: 'Key' });
  const renamed = registry.rename(device.id, '  Key light  ');
  assert.equal(renamed.name, 'Key light');
  assert.equal(renamed.address, 'AA:AA:AA:AA:AA:01');
  assert.equal(renamed.id, device.id);
  assert.equal(registry.rename(device.id, '   ').name, 'Key light', 'a blank name is ignored');
});

test('every change is persisted with the new default', () => {
  const { registry, store } = makeRegistry();
  const a = registry.add({ address: 'AA:AA:AA:AA:AA:01' });
  const b = registry.add({ address: 'AA:AA:AA:AA:AA:02' });
  assert.equal(store.writes.length, 2);
  assert.equal(store.writes.at(-1).activeId, a.id);
  registry.remove(a.id);
  assert.equal(store.writes.at(-1).activeId, b.id);
  assert.equal(store.writes.at(-1).devices.length, 1);
});

test('a failing store never breaks a registration', () => {
  const registry = new DeviceRegistry(
    {
      save() {
        throw new Error('disk full');
      },
    },
    { createLight: (d) => new StubLight(d) }
  );
  const device = registry.add({ address: 'AA:AA:AA:AA:AA:01' });
  assert.equal(registry.devices.size, 1);
  assert.ok(device.id);
});

test('change events carry the device that moved', () => {
  const { registry } = makeRegistry();
  const events = [];
  registry.on('change', (payload) => events.push(payload.deviceId));
  const a = registry.add({ address: 'AA:AA:AA:AA:AA:01' });
  registry.rename(a.id, 'Key');
  // add() signals the list changed shape, a rename is scoped to its device.
  assert.deepEqual(events, [undefined, a.id]);
});

test('snapshots expose one entry per device for the encoders', () => {
  const { registry } = makeRegistry();
  registry.add({ address: 'AA:AA:AA:AA:AA:01', name: 'Key' });
  registry.add({ address: 'AA:AA:AA:AA:AA:02', name: 'Fill' });
  const snaps = registry.snapshots();
  assert.equal(Object.keys(snaps).length, 2);
  const names = Object.values(snaps).map((s) => s.name).sort();
  assert.deepEqual(names, ['Fill', 'Key']);
  for (const snap of Object.values(snaps)) {
    assert.equal(typeof snap.connected, 'boolean');
    assert.equal(typeof snap.brightness, 'number');
  }
});

test('changing the address of a registered device re-targets its light', () => {
  const { registry } = makeRegistry();
  const device = registry.add({ address: 'AA:AA:AA:AA:AA:01', name: 'Key' });
  const light = registry.lightFor(device.id);
  registry.setAddress(device.id, 'bb:bb:bb:bb:bb:bb', 'Moved');
  assert.equal(light.address, 'BB:BB:BB:BB:BB:BB');
  assert.equal(light.name, 'Moved');
  assert.equal(registry.get(device.id).address, 'BB:BB:BB:BB:BB:BB');
});
