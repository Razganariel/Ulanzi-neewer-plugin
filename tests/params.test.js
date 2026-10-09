/**
 * Dial parameter helpers.
 *
 * Each encoder action owns one physical dial and a property inspector, so the
 * same parsing rules would otherwise be copy-pasted per action and drift apart.
 * The host hands settings back as strings sometimes and numbers other times
 * depending on how they were typed, so every read goes through these helpers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { bool, clamp, dialStep, nextPreset, parseList, wrap } from '../plugin/service/core/params.js';

test('clamp keeps integers inside range and falls back when unusable', () => {
  assert.equal(clamp(50, 0, 100, 10), 50);
  assert.equal(clamp(-5, 0, 100, 10), 0);
  assert.equal(clamp(500, 0, 100, 10), 100);
  assert.equal(clamp(3.6, 0, 100, 10), 4, 'rounded, not truncated');
  assert.equal(clamp('abc', 0, 100, 10), 10);
  assert.equal(clamp(undefined, 0, 100, 10), 10);
  assert.equal(clamp('', 0, 100, 10), 10, 'an empty field must not become 0');
});

test('a dial step wider than its range is refused', () => {
  assert.equal(dialStep(5, 0, 100, 5), 5);
  assert.equal(dialStep(0, 0, 100, 5), 5, 'zero would freeze the dial');
  assert.equal(dialStep(500, 0, 100, 5), 5, 'wider than the range');
  assert.equal(dialStep(999, 2500, 8500, 250), 999, 'no allowed list here');
});

test('dialStep honours an allow list', () => {
  assert.equal(dialStep(7, 0, 100, 5, [1, 2, 5, 10]), 5, 'unsupported step falls back');
  assert.equal(dialStep(10, 0, 100, 5, [1, 2, 5, 10]), 10);
  // A CCT step finer than the wire can express must not survive.
  assert.equal(dialStep(50, 2500, 8500, 250, [100, 200, 250, 300, 500]), 250);
});

test('parseList reads numbers, drops junk and de-duplicates', () => {
  assert.deepEqual(parseList('0,30,60'), [0, 30, 60]);
  assert.deepEqual(parseList(' 10 , 20 ,abc ,, 30 '), [10, 20, 30]);
  assert.deepEqual(parseList('10,10,20'), [10, 20], 'duplicates removed, order kept');
  assert.deepEqual(parseList(''), []);
  assert.deepEqual(parseList(null), []);
  assert.deepEqual(parseList('abc,def'), []);
});

test('nextPreset advances and wraps', () => {
  assert.equal(nextPreset([0, 60, 120], 0), 60);
  assert.equal(nextPreset([0, 60, 120], 60), 120);
  assert.equal(nextPreset([0, 60, 120], 120), 0, 'wraps past the last');
  assert.equal(nextPreset([0, 60], 999), 0, 'a full sweep always moves');
  assert.equal(nextPreset([], 0), null, 'no presets means no-op');
  assert.equal(nextPreset([42], 0), 42, 'a lone preset stays on itself');
});

test('bool reads the string forms the host stores', () => {
  assert.equal(bool('false', true), false);
  assert.equal(bool(false, true), false);
  assert.equal(bool('true', false), true);
  assert.equal(bool('0', true), false);
  assert.equal(bool(undefined, true), true, 'absent keeps the default');
  assert.equal(bool('', true), true, 'an empty field is not a choice');
});

test('wrap cycles in both directions', () => {
  // Brightness spans 1-100 inclusive: 100 distinct values, so the cycle length is
  // 100 and the arithmetic is on (value - 1).
  assert.equal(wrap(105, 1, 100), 5);
  assert.equal(wrap(0, 1, 100), 100, 'the bottom wraps to the top');
  assert.equal(wrap(101, 1, 100), 1);
  assert.equal(wrap(-1, 1, 100), 99, 'one below the floor is 99');
  assert.equal(wrap(50, 1, 100), 50);
  // CCT spans 2500-8500 inclusive: 6001 distinct values, cycle length 6001.
  assert.equal(wrap(8501, 2500, 8500), 2500, 'exactly one past the top wraps to the bottom');
  assert.equal(wrap(8500, 2500, 8500), 8500);
  assert.equal(wrap(2400, 2500, 8500), 8401, '100 below the floor');
  assert.equal(wrap(2350, 2500, 8500), 8351);
});