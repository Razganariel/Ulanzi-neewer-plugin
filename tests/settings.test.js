/**
 * What the plugin writes to the host's global settings.
 *
 * `address` and `name` exist only so an installation saved by an older build still reads
 * back as one light. They are the most likely place for a stale value to survive a
 * deletion, which is why the fallback rules are pinned here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeDeviceFields, buildSettings, emptySettings } from '../plugin/service/core/settings.js';

const light = (id, name) => ({ id, address: `AA:AA:AA:AA:AA:${id.slice(-2)}`, name });

test('the single-light fields follow the default device', () => {
  const devices = [light('x1', 'Key'), light('x2', 'Fill')];
  assert.deepEqual(activeDeviceFields(devices, 'x2'), { address: 'AA:AA:AA:AA:AA:x2', name: 'Fill' });
});

test('a default that points at a deleted light falls back to a real one', () => {
  // The default is remembered by id, so removing that light leaves the id dangling until
  // the registry rewrites it. Saving in between must not write an empty address.
  const devices = [light('x1', 'Key')];
  assert.deepEqual(activeDeviceFields(devices, 'gone'), { address: 'AA:AA:AA:AA:AA:x1', name: 'Key' });
});

test('the last light removed leaves nothing behind', () => {
  // The failure this guards: the address of a deleted light surviving in the settings,
  // so the next start tried to connect to a fixture the user had removed.
  assert.deepEqual(activeDeviceFields([], 'gone'), { address: '', name: '' });
});

test('the settings carry the devices, the default and what each light was told', () => {
  const devices = [light('x1', 'Key')];
  const states = { x1: { power: true, brightness: 42 } };
  assert.deepEqual(buildSettings(devices, 'x1', states), {
    devices,
    activeId: 'x1',
    states,
    address: 'AA:AA:AA:AA:AA:x1',
    name: 'Key',
  });
});

test('settings with no remembered state still save', () => {
  // An older installation has no `states` at all. Reading `undefined.states` here would
  // throw inside the save, which the registry can only swallow, so the belief of every
  // fixture would silently stop being written.
  const saved = buildSettings([light('x1', 'Key')], 'x1', undefined);
  assert.deepEqual(saved.states, {});
});

test('a settings read with nothing in it describes no light', () => {
  const settings = emptySettings();
  assert.deepEqual(settings.devices, []);
  assert.deepEqual(settings.states, {});
  assert.equal(settings.address, '');
  assert.equal(settings.name, '');
});
