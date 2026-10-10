/**
 * Neewer "0x78" BLE wire protocol (studio lights: RGB62, RGB660, SL-80, GL1, ...).
 *
 * Every frame is a short byte string whose last byte is a checksum: the sum of
 * all preceding bytes truncated to its lowest 8 bits. Traces captured from the
 * NEEWER app / reverse engineering write-ups:
 *
 *   power on   78 81 01 01 FB
 *   power off  78 81 01 02 FC
 *   colour     78 86 04 <hue> <hueHi> <sat> <bri> <chk>
 *   CCT        78 87 02 <bri> <cct> <chk>
 *
 * Pure module: no BLE, no Node API, so it stays unit-testable.
 */

import { LIMITS } from './constants.js';

const MAGIC = 0x78;

const OP = Object.freeze({
  POWER: 0x81,
  HSL: 0x86,
  CCT: 0x87,
  EFFECT: 0x88,
  /** Emitted by the fixture on connect: its address plus a level byte. */
  DEVICE: 0x05,
});

/** Value of the length byte at index 2, i.e. the number of payload bytes. */
const PAYLOAD_LEN = Object.freeze({
  [OP.POWER]: 1,
  [OP.HSL]: 4,
  [OP.CCT]: 2,
  [OP.EFFECT]: 2,
});

const POWER_ON = 0x01;
const POWER_OFF = 0x02;

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function byte(value) {
  return clampInt(value, 0, 0xff, 0);
}

export function checksum(body) {
  let sum = 0;
  for (const b of body) sum += b;
  return sum & 0xff;
}

function build(op, payload) {
  if (payload.length !== PAYLOAD_LEN[op]) {
    throw new Error(`Neewer 0x${op.toString(16)} expects ${PAYLOAD_LEN[op]} payload byte(s), got ${payload.length}`);
  }
  const body = [MAGIC, op, PAYLOAD_LEN[op], ...payload];
  return Buffer.from([...body, checksum(body)]);
}

export function normalizeHue(hue) {
  const h = clampInt(hue, LIMITS.HUE.min, LIMITS.HUE.max, LIMITS.HUE.min);
  return h === LIMITS.HUE.max ? 0 : h;
}

export function normalizeSaturation(sat) {
  return clampInt(sat, LIMITS.SATURATION.min, LIMITS.SATURATION.max, LIMITS.SATURATION.max);
}

export function normalizeBrightness(bri) {
  return clampInt(bri, LIMITS.BRIGHTNESS.min, LIMITS.BRIGHTNESS.max, LIMITS.BRIGHTNESS.max);
}

export function normalizeCct(kelvin) {
  return clampInt(kelvin, LIMITS.CCT.min, LIMITS.CCT.max, LIMITS.CCT.min);
}

/** 0x78 0x81 0x01 <01|02> <chk> */
export function powerFrame(on) {
  return build(OP.POWER, [on ? POWER_ON : POWER_OFF]);
}

/** 0x78 0x86 0x04 <hue%256> <hue>>8> <sat 0-100> <bri 0-100> <chk> */
export function hslFrame(hue, saturation, brightness) {
  const h = normalizeHue(hue);
  return build(OP.HSL, [h % 256, Math.floor(h / 256), normalizeSaturation(saturation), normalizeBrightness(brightness)]);
}

/** 0x78 0x87 0x02 <bri 0-100> <kelvin/100> <chk> */
export function cctFrame(kelvin, brightness) {
  return build(OP.CCT, [normalizeBrightness(brightness), byte(Math.round(normalizeCct(kelvin) / 100))]);
}

/**
 * Brightness-only update. The fixture has no dedicated brightness frame, so the
 * active colour mode is re-sent with the new level, exactly like the app does.
 */
export function brightnessFrame(mode, state) {
  if (mode === 'cct') return cctFrame(state.cct, state.brightness);
  return hslFrame(state.hue, state.saturation, state.brightness);
}

export function isValidFrame(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return false;
  if (buffer[0] !== MAGIC) return false;
  const body = buffer.subarray(0, buffer.length - 1);
  return buffer[buffer.length - 1] === checksum(body);
}

/**
 * Best-effort decode of a notification. Only the frames we have confirmed are
 * interpreted; anything else is ignored rather than guessed at.
 */
export function parseNotification(buffer) {
  if (!isValidFrame(buffer)) return null;
  const op = buffer[1];
  const payload = buffer.subarray(3, buffer.length - 1);

  switch (op) {
    case OP.POWER:
      if (payload[0] === POWER_ON) return { kind: 'power', on: true };
      if (payload[0] === POWER_OFF) return { kind: 'power', on: false };
      return null;
    case OP.HSL:
      if (payload.length < 4) return null;
      return {
        kind: 'hsl',
        mode: 'hsl',
        hue: payload[0] + payload[1] * 256,
        saturation: payload[2],
        brightness: payload[3],
      };
    case OP.CCT:
      if (payload.length < 2) return null;
      return { kind: 'cct', mode: 'cct', brightness: payload[0], cct: payload[1] * 100 };
    case OP.EFFECT:
      if (payload.length < 2) return null;
      return { kind: 'effect', brightness: payload[0], effect: payload[1] };
    case OP.DEVICE: {
      // Observed on a RGB62 the moment the link came up:
      //   78 05 07 F4 9F 7F 53 F0 B8 64 F5
      // -> 7 payload bytes: the 6-byte device address, then a level byte.
      if (payload.length < 7) return null;
      const address = Array.from(payload.subarray(0, 6), (b) => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
      return { kind: 'device', address, level: payload[6] };
    }
    default:
      return null;
  }
}
