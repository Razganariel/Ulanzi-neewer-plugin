/**
 * One fixture session, without a radio.
 *
 * `NeewerLight` builds its transport but does not start it: the helper is only
 * spawned on the first scan, connect or write. A light can therefore be built,
 * fed a frame and inspected here, which is the only way to test what the fixture
 * says about itself without opening a BLE link.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { NeewerLight, sanitizeState } from '../plugin/service/core/light.js';
import { hslFrame, parseNotification, powerFrame } from '../plugin/service/core/protocol.js';

const ADDRESS = 'AA:BB:CC:DD:EE:FF';
const build = (state) => new NeewerLight({ address: ADDRESS, name: 'Key' }, state);
/** The frame the fixture volunteers on its own: opcode 0x05, address, level. */
const deviceFrame = (level) => Buffer.from('7805' + '07' + 'AABBCCDDEEFF' + level.toString(16).padStart(2, '0') + '00', 'hex');

test('building a light does not start the native helper', () => {
  // The whole reason this file can exist: if the constructor spawned nlink.exe, every
  // test here would open a real radio session.
  const light = build();
  assert.equal(light.transport.link, null, 'no helper process yet');
  assert.equal(light.connected, false);
});

test('the frame the fixture volunteers changes nothing', () => {
  // Measured on a RGB62: this frame reports level 100 with the lamp lit and 100 with
  // it unlit, and on one restart it is not delivered at all. A value that does not move
  // with the lamp is not a state, so deriving power or brightness from it would put a
  // confident wrong number on the deck.
  const light = build({ brightness: 40, power: true });
  const before = { ...light.state };

  light._onNotify(deviceFrame(100));

  assert.deepEqual(light.state, before, 'not one field moved');
  assert.equal('level' in light.snapshot(), false, 'and nothing derived is exposed');
});

/**
 * A transport that records everything and writes nothing back, so the link lifecycle
 * can be exercised without the native helper or a radio.
 */
function fakeTransport() {
  const writes = [];
  return {
    writes,
    address: null,
    onFrame: null,
    async connect(address) {
      this.address = address;
      return { address, name: 'Fake' };
    },
    async write(frame) {
      writes.push(frame);
    },
    async close() {},
    on() {},
  };
}

test('opening a fixture writes nothing, so a lamp that is on stays on', async () => {
  // Every frame this protocol carries is a command: a colour frame switches the lamp
  // on, a power frame switches it off. Re-asserting the cached state on connect imposed
  // a state instead of observing one, which is how starting UlanziDeck with the lamp
  // already on used to turn it off.
  const transport = fakeTransport();
  const light = new NeewerLight({ address: 'AA:BB:CC:DD:EE:FF' }, { power: true, brightness: 40 }, transport);

  await light.connect();

  assert.equal(light.connected, true, 'the link is up');
  assert.deepEqual(transport.writes, [], 'and not one frame was sent');
  assert.equal(light.state.brightness, 40, 'the remembered state is untouched');
});

test('a reconnect after a drop still does not impose a state', async () => {
  const transport = fakeTransport();
  const light = new NeewerLight({ address: 'AA:BB:CC:DD:EE:FF' }, { power: true, brightness: 40 }, transport);

  await light.connect();
  await light.connect();

  assert.deepEqual(transport.writes, [], 'a second link is as silent as the first');
  assert.equal(light.state.brightness, 40);
});

test('a power notification does move the state, unlike the level frame', () => {
  // The contrast that makes the previous test meaningful: the handler works, it simply
  // has nothing to act on for 0x05.
  assert.deepEqual(parseNotification(powerFrame(false)), { kind: 'power', on: false });

  const light = build({ power: true });
  light._onNotify(powerFrame(false));
  assert.equal(light.state.power, false);
});

test('a colour notification is believed', () => {
  const light = build({ power: false });
  light._onNotify(hslFrame(200, 80, 60));
  assert.equal(light.state.mode, 'hsl');
  assert.equal(light.state.hue, 200);
  assert.equal(light.state.saturation, 80);
  assert.equal(light.state.brightness, 60);
  assert.equal(light.state.power, true, 'a colour frame proves the lamp is lit');
});

test('a restart starts on the last command, not on the defaults', () => {
  // The report: the deck came back claiming brightness 100 while the lamp sat at 5, and
  // one notch of the dial then computed 105 and dropped the lamp to 5%.
  const light = build({ brightness: 40, hue: 0, saturation: 0, cct: 3400, mode: 'cct', power: true });
  assert.equal(light.state.brightness, 40);
  assert.equal(light.state.cct, 3400);
  assert.equal(light.state.mode, 'cct');
  assert.equal(light.state.power, true);
});

test('with nothing remembered, the defaults still apply', () => {
  // The honest gap: until the user commands something, the values are ours and not the
  // lamp's. The README says so.
  const light = build();
  assert.equal(light.state.brightness, 100);
  assert.equal(light.state.power, false);
});

test('a settings file cannot put a light in a state no action could reach', () => {
  // An unknown mode and a non-numeric brightness are dropped, not coerced, so the
  // defaults underneath them survive. A numeric string is still a number, because the
  // host stores settings as strings.
  assert.deepEqual(sanitizeState({ power: 0, brightness: 'bright', mode: 'strobe', address: 'nope' }), {
    power: false,
  });
  assert.deepEqual(sanitizeState(null), {});
  assert.deepEqual(sanitizeState('nope'), {});
  assert.equal(sanitizeState({ brightness: '42' }).brightness, 42);
});
