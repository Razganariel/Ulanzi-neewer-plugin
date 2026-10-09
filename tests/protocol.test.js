/**
 * Protocol tests, anchored on frames captured from the NEEWER app and from the
 * public reverse-engineering write-ups. If the RGB62 ever answers differently
 * on the wire, these fail first.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  brightnessFrame,
  cctFrame,
  checksum,
  hslFrame,
  isValidFrame,
  normalizeHue,
  parseNotification,
  powerFrame,
} from '../plugin/service/core/protocol.js';

const hex = (buffer) => buffer.toString('hex');

test('checksum is the truncated byte sum of the frame body', () => {
  assert.equal(checksum([0x78, 0x86, 0x04, 0x58, 0x01, 0x18, 0x64]), 0xd7);
  assert.equal(checksum([0x78, 0x81, 0x01, 0x01]), 0xfb);
});

test('power frames match the captured NEEWER app bytes', () => {
  assert.equal(hex(powerFrame(true)), '78810101fb');
  assert.equal(hex(powerFrame(false)), '78810102fc');
});

test('HSL frame reproduces the RGB660 capture (hue 344, sat 24, bri 100)', () => {
  assert.equal(hex(hslFrame(344, 24, 100)), '78860458011864d7');
});

test('HSL frame follows the gatttool capture, with brightness clamped to 1', () => {
  // Captured on the wire: 78 86 04 d1 00 64 00 37 (hue 209, sat 100, bri 0).
  // A brightness of 0 is not a supported level here, so it is sent as 1 and only
  // the checksum differs: 78 86 04 d1 00 64 01 38.
  assert.equal(hex(hslFrame(209, 100, 0)), '788604d100640138');
  assert.equal(hex(hslFrame(209, 100, 1)), '788604d100640138');
});

test('hue overflow byte carries the bits above 255 degrees', () => {
  const frame = hslFrame(300, 100, 100);
  assert.equal(frame[3], 300 - 256);
  assert.equal(frame[4], 1);
});

test('CCT frame matches the captured bytes (bri 100, 3800K)', () => {
  assert.equal(hex(cctFrame(3800, 100)), '78870264268b');
});

test('CCT frame encodes kelvin as kelvin/100', () => {
  assert.equal(cctFrame(5600, 50)[4], 56);
  assert.equal(cctFrame(2500, 50)[4], 25);
  assert.equal(cctFrame(8500, 50)[4], 85);
});

test('brightnessFrame re-sends the active mode with the new level', () => {
  const state = { mode: 'hsl', hue: 120, saturation: 100, brightness: 40, cct: 5600 };
  assert.deepEqual(brightnessFrame('hsl', state), hslFrame(120, 100, 40));
  assert.deepEqual(brightnessFrame('cct', state), cctFrame(5600, 40));
});

test('values are clamped into the fixture limits', () => {
  assert.equal(hslFrame(999, 999, 999)[3], 0, 'hue wraps to 0 instead of overflowing');
  assert.equal(hslFrame(200, 999, 999)[5], 100);
  assert.equal(hslFrame(200, 0, 999)[6], 100);
  assert.equal(hslFrame(200, 0, 0)[6], 1, 'brightness 0 clamps to 1; use power off to black out');
  assert.equal(cctFrame(1000, 50)[4], 25);
  assert.equal(cctFrame(20000, 50)[4], 85);
});

test('360 degrees is normalised to 0', () => {
  assert.equal(normalizeHue(360), 0);
  assert.equal(normalizeHue(-30), 0);
  assert.equal(hslFrame(360, 100, 100)[4], 0);
});

test('every generated frame passes its own checksum', () => {
  for (const frame of [powerFrame(true), powerFrame(false), hslFrame(123, 45, 67), cctFrame(4300, 80)]) {
    assert.ok(isValidFrame(frame), `invalid frame ${hex(frame)}`);
  }
});

test('isValidFrame rejects foreign or corrupted payloads', () => {
  assert.equal(isValidFrame(Buffer.from('78810101fc', 'hex')), false);
  assert.equal(isValidFrame(Buffer.from('aabbcc', 'hex')), false);
  assert.equal(isValidFrame(Buffer.from('78', 'hex')), false);
  assert.equal(isValidFrame('nope'), false);
});

test('notifications are decoded back into light state', () => {
  assert.deepEqual(parseNotification(hslFrame(200, 80, 60)), {
    kind: 'hsl',
    mode: 'hsl',
    hue: 200,
    saturation: 80,
    brightness: 60,
  });
  assert.deepEqual(parseNotification(cctFrame(4500, 70)), { kind: 'cct', mode: 'cct', brightness: 70, cct: 4500 });
  assert.deepEqual(parseNotification(powerFrame(false)), { kind: 'power', on: false });
  // Captured live from an RGB62 as the link came up.
  assert.deepEqual(parseNotification(Buffer.from('780507F49F7F53F0B864F5', 'hex')), {
    kind: 'device',
    address: 'F4:9F:7F:53:F0:B8',
    level: 100,
  });
  assert.equal(parseNotification(Buffer.from('00ff', 'hex')), null);
  assert.equal(parseNotification(Buffer.from('780507F49F7F53F0B86400', 'hex')), null);
});
