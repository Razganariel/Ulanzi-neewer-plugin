/**
 * Leaving the service: what the user last did to a light has to be on disk before the
 * process goes, however the process goes.
 *
 * The debounced settings write is unref'd, so it cannot keep the process alive. These
 * tests cover the other half of that bargain: every way out writes the pending belief
 * first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installShutdownHandlers } from '../plugin/service/core/shutdown.js';
import { DeviceRegistry } from '../plugin/service/core/devices.js';
import { sanitizeState } from '../plugin/service/core/light.js';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class StubLight {
  constructor(device, initialState) {
    this.listeners = new Map();
    this.state = sanitizeState(initialState);
  }
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }
  emit(event, payload) {
    for (const fn of this.listeners.get(event) || []) fn(payload);
  }
  connect() {}
  setAddress() {}
  stop() {}
  snapshot() {
    return { ...this.state };
  }
}

/** A registry with one light whose belief has just changed, so a write is pending. */
function dirtyRegistry() {
  const writes = [];
  const registry = new DeviceRegistry(
    { save: (devices, activeId, states) => writes.push({ devices, activeId, states }) },
    { createLight: (device, state) => new StubLight(device, state) }
  );
  const device = registry.add({ address: 'AA:AA:AA:AA:AA:AA', name: 'Key' });
  const light = registry.lights.get(device.id);
  light.state = { power: true, mode: 'hsl', brightness: 7, hue: 0, saturation: 0, cct: 5600 };
  light.emit('state', light.snapshot());
  return { registry, writes, device };
}

test('the pending write is not what keeps the service alive', () => {
  // The debounce timer is unref'd, so a settings write can never be the reason the
  // process refuses to end. If this ever stops being true the service would hang on
  // exit instead of writing.
  const { registry } = dirtyRegistry();
  assert.ok(registry._persistTimer, 'a write is pending');
  assert.equal(registry._persistTimer.hasRef(), false, 'the pending write holds the process open');
});

test('SIGINT writes the pending belief before leaving', () => {
  const emitter = new EventEmitter();
  const { registry, writes } = dirtyRegistry();
  const codes = [];
  installShutdownHandlers(registry, { emitter, exit: (code) => codes.push(code) });

  const before = writes.length;
  emitter.emit('SIGINT');
  assert.ok(writes.length > before, 'the pending write went out');
  assert.equal(writes.at(-1).states[registry.devices.keys().next().value].brightness, 7);
  assert.deepEqual(codes, [0], 'and the process was asked to leave');
});

test('SIGTERM writes the pending belief before leaving too', () => {
  // A host that terminates politely sends this rather than SIGINT. Treating it as a
  // crash would drop the last command on exactly the shutdowns users notice.
  const emitter = new EventEmitter();
  const { registry, writes } = dirtyRegistry();
  const codes = [];
  installShutdownHandlers(registry, { emitter, exit: (code) => codes.push(code) });

  const before = writes.length;
  emitter.emit('SIGTERM');
  assert.ok(writes.length > before, 'the pending write went out');
  assert.deepEqual(codes, [0]);
});

test('the exit event writes the pending belief', () => {
  // Covers the shutdowns no signal handler sees: the host closing the websocket, or the
  // event loop running dry because nothing else is holding it.
  const emitter = new EventEmitter();
  const { registry, writes } = dirtyRegistry();
  installShutdownHandlers(registry, { emitter, exit: () => {} });

  const before = writes.length;
  emitter.emit('exit');
  assert.ok(writes.length > before, 'the pending write went out');
});

test('a failing store does not stop the process from leaving', () => {
  const emitter = new EventEmitter();
  const registry = new DeviceRegistry(
    {
      save() {
        throw new Error('settings are gone');
      },
    },
    { createLight: (device, state) => new StubLight(device, state) }
  );
  installShutdownHandlers(registry, { emitter, exit: () => {} });
  const device = registry.add({ address: 'AA:AA:AA:AA:AA:AA', name: 'Key' });
  const light = registry.lights.get(device.id);
  light.state = { power: true, mode: 'hsl', brightness: 7, hue: 0, saturation: 0, cct: 5600 };
  light.emit('state', light.snapshot());

  assert.doesNotThrow(() => emitter.emit('exit'), 'a store that cannot write must not throw on the way out');
});

test('a process that just runs dry still writes what it was told', async () => {
  // The whole point of the unref'd timer, tested the way it actually happens: a real
  // process, nothing holding the event loop open, so it ends by itself right after the
  // belief changed. The write still has to be there when it does.
  const script = `
    import { writeFileSync } from 'node:fs';
    import { installShutdownHandlers } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'plugin/service/core/shutdown.js')).href)};
    import { DeviceRegistry } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'plugin/service/core/devices.js')).href)};
    import { sanitizeState } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'plugin/service/core/light.js')).href)};

    const out = process.argv[1];
    const registry = new DeviceRegistry(
      { save: (devices, activeId, states) => writeFileSync(out, JSON.stringify({ devices, activeId, states })) },
      {
        createLight: (device, state) => {
          const listeners = new Map();
          return {
            state: sanitizeState(state),
            on: (e, fn) => listeners.set(e, [...(listeners.get(e) || []), fn]),
            emit: (e, p) => (listeners.get(e) || []).forEach((fn) => fn(p)),
            connect() {}, setAddress() {}, stop() {},
            snapshot() { return { ...this.state }; },
          };
        },
      }
    );
    installShutdownHandlers(registry);

    const device = registry.add({ address: 'AA:AA:AA:AA:AA:AA', name: 'Key' });
    const light = registry.lights.get(device.id);
    light.state = { power: true, mode: 'hsl', brightness: 7, hue: 0, saturation: 0, cct: 5600 };
    light.emit('state', light.snapshot());
    // Nothing else is scheduled, so the loop is empty except for the unref'd write.
  `;
  const target = path.join(ROOT, 'tests', '.shutdown-natural-exit.json');
  await run(process.execPath, ['--input-type=module', '-e', script, target], { cwd: ROOT });

  const saved = JSON.parse(readFileSync(target, 'utf8'));
  assert.equal(Object.values(saved.states)[0].brightness, 7, 'the last command survived the process ending');
  rmSync(target, { force: true });
});
