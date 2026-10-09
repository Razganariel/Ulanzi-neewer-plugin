/**
 * Action instance bookkeeping.
 *
 * The bug these tests pin down: removing an action from a Stream Deck key and
 * placing the same action back on that key left the key blank while the Ulanzi UI
 * showed it. The host redraws its own view from its own model; the deck key is
 * drawn only by this plugin, so a context the service does not know about can
 * never be drawn, however correct the host's state is.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeContext, ensureEntry, forget, forgetActionId, slotOf } from '../plugin/service/core/context.js';

const UUID = 'com.ulanzi.ulanzistudio.neewer';
const actions = {
  [`${UUID}.hue`]: { uuid: `${UUID}.hue`, defaults: { step: 10, presets: '0,30,60' } },
  [`${UUID}.cct`]: { uuid: `${UUID}.cct`, defaults: { step: 250, presets: '' } },
};
const findAction = (uuid) => actions[uuid];

const ctx = (key, actionid, action = 'hue') => `${UUID}.${action}___${key}___${actionid}`;

test('decodeContext splits the SDK context string', () => {
  assert.deepEqual(decodeContext(ctx('3_3', 'abc')), {
    uuid: `${UUID}.hue`,
    key: '3_3',
    actionid: 'abc',
  });
});

test('decodeContext tolerates the undefined the host sends for missing fields', () => {
  // String(undefined) would leak the literal "undefined" into every lookup.
  assert.deepEqual(decodeContext(`${UUID}.hue___3_3___undefined`), {
    uuid: `${UUID}.hue`,
    key: '3_3',
    actionid: '',
  });
  assert.deepEqual(decodeContext(''), { uuid: '', key: '', actionid: '' });
  assert.deepEqual(decodeContext(undefined), { uuid: '', key: '', actionid: '' });
});

test('slotOf ignores the instance id so a whole key can be purged', () => {
  assert.equal(slotOf(ctx('3_3', 'abc')), `${UUID}.hue___3_3`);
  assert.equal(slotOf(ctx('3_3', 'other')), slotOf(ctx('3_3', 'abc')), 'same key, same slot');
  assert.notEqual(slotOf(ctx('3_3', 'abc')), slotOf(ctx('4_3', 'abc')));
});

test('an add registers the action and seeds its settings', () => {
  const contexts = new Map();
  const { entry, created } = ensureEntry(contexts, ctx('3_3', 'abc'), { uuid: `${UUID}.hue` }, findAction);
  assert.equal(created, true);
  assert.equal(entry.action.uuid, `${UUID}.hue`);
  assert.deepEqual(entry.settings, { step: 10, presets: '0,30,60' });
  assert.equal(contexts.size, 1);
});

test('a later event rebuilds a context that was never added', () => {
  // The reported failure: the key holds an action again, but no add was sent, so
  // the map is empty and the deck key can never be drawn.
  const contexts = new Map();
  assert.equal(contexts.size, 0, 'precondition: nothing known about the key');

  // A run event is the only thing that arrives; the action uuid is in the context.
  const { entry, created } = ensureEntry(contexts, ctx('3_3', 'abc'), {}, findAction);
  assert.equal(created, true, 'the action must be recovered from the context');
  assert.equal(entry.action.uuid, `${UUID}.hue`);
  assert.deepEqual(entry.settings, { step: 10, presets: '0,30,60' }, 'defaults, since the host sent none');
});

test('an unknown context recovers nothing instead of inventing an action', () => {
  const contexts = new Map();
  const { entry, created } = ensureEntry(contexts, 'other.plugin___3_3___abc', {}, findAction);
  assert.equal(entry, null);
  assert.equal(created, false);
  assert.equal(contexts.size, 0);
});

test('after a removal, recovery starts from the defaults', () => {
  // forget() drops the entry, so a recovery cannot inherit anything from it. That
  // is deliberate: the entry is the only memory of the old instance, and the host
  // answers the getSettings() that follows an add with the real values. Falling
  // back to the defaults for the frames in between is visible and harmless,
  // whereas inheriting a stale value would not be.
  const contexts = new Map();
  ensureEntry(contexts, ctx('3_3', 'abc'), { uuid: `${UUID}.hue`, param: { step: 30 } }, findAction);
  forget(contexts, ctx('3_3', 'abc'));

  const { entry } = ensureEntry(contexts, ctx('3_3', 'abc'), {}, findAction);
  assert.equal(entry.settings.step, 10, 'the default, not the removed step');
});

test('a surviving entry keeps its settings across repeated events', () => {
  // The no-clear case: the host re-sends an event for a context still in the map.
  const contexts = new Map();
  ensureEntry(contexts, ctx('3_3', 'abc'), { uuid: `${UUID}.hue`, param: { step: 30 } }, findAction);
  const { entry } = ensureEntry(contexts, ctx('3_3', 'abc'), { uuid: `${UUID}.hue` }, findAction);
  assert.equal(entry.settings.step, 30, 'the step the user chose');
});

test('a host param wins over a recovered setting', () => {
  const contexts = new Map();
  ensureEntry(contexts, ctx('3_3', 'abc'), { uuid: `${UUID}.hue`, param: { step: 30 } }, findAction);
  const { entry } = ensureEntry(contexts, ctx('3_3', 'abc'), { param: { step: 5 } }, findAction);
  assert.equal(entry.settings.step, 5);
});

test('switching actions on one key discards the previous action settings', () => {
  // Hue settings must not leak into CCT: the two have different keys, and a
  // leftover `step: 10` on the CCT dial would be a silent wrong value.
  const contexts = new Map();
  ensureEntry(contexts, ctx('3_3', 'abc'), { uuid: `${UUID}.hue`, param: { step: 30, presets: '0,30' } }, findAction);
  const { entry } = ensureEntry(contexts, ctx('3_3', 'abc'), { uuid: `${UUID}.cct`, param: {} }, findAction);
  assert.equal(entry.action.uuid, `${UUID}.cct`);
  assert.equal(entry.settings.step, 250, 'CCT default, not the hue 30');
  assert.equal(entry.settings.presets, '');
});

test('a repeated event for a known context does not recreate it', () => {
  const contexts = new Map();
  ensureEntry(contexts, ctx('3_3', 'abc'), { uuid: `${UUID}.hue` }, findAction);
  const first = contexts.get(ctx('3_3', 'abc'));
  const { created, entry } = ensureEntry(contexts, ctx('3_3', 'abc'), { uuid: `${UUID}.hue`, param: { step: 15 } }, findAction);
  assert.equal(created, false);
  assert.equal(contexts.get(ctx('3_3', 'abc')), first, 'same object, no duplicate');
  assert.equal(entry.settings.step, 15, 'but the new setting is applied');
});

test('forget removes the entry, then the whole slot when the context is partial', () => {
  const contexts = new Map();
  ensureEntry(contexts, ctx('3_3', 'abc'), { uuid: `${UUID}.hue` }, findAction);
  assert.equal(forget(contexts, ctx('3_3', 'abc')), 1);
  assert.equal(contexts.size, 0);

  // Two instances left on the same key, removed by a frame with no actionid.
  ensureEntry(contexts, ctx('3_3', 'abc'), { uuid: `${UUID}.hue` }, findAction);
  ensureEntry(contexts, ctx('3_3', 'def'), { uuid: `${UUID}.hue` }, findAction);
  ensureEntry(contexts, ctx('4_3', 'ghi'), { uuid: `${UUID}.hue` }, findAction);
  assert.equal(forget(contexts, `${UUID}.hue___3_3___undefined`), 2, 'both instances of that key');
  assert.equal(contexts.size, 1, 'the other key is untouched');
});

test('moving an action to another key drops the key it left', () => {
  // Observed in the host log: brightness bacfa1cb added on 1_0, then moved to
  // 1_2 with only a setactive. No clear for 1_0, no add for 1_2. Keeping both
  // contexts means every redraw also paints 1_0, which no longer holds the
  // action, and the new key depends on a later frame to appear at all.
  const contexts = new Map();
  const moved = ctx('1_0', 'bacfa1cb');
  const destination = ctx('1_2', 'bacfa1cb');
  ensureEntry(contexts, moved, { uuid: `${UUID}.hue` }, findAction);

  const { entry, created } = ensureEntry(contexts, destination, { uuid: `${UUID}.hue`, param: { step: 5 } }, findAction);
  const ghosts = forgetActionId(contexts, 'bacfa1cb', destination);

  assert.equal(created, true, 'the new key is a fresh context');
  assert.equal(entry.settings.step, 5);
  assert.equal(ghosts, 1, 'the context for the key it left is gone');
  assert.equal(contexts.has(moved), false, '1_0 is not redrawn any more');
  assert.equal(contexts.has(destination), true);
  assert.equal(contexts.size, 1);
});

test('a move keeps the settings, since the instance is the same', () => {
  const contexts = new Map();
  ensureEntry(contexts, ctx('1_0', 'bacfa1cb'), { uuid: `${UUID}.hue`, param: { step: 30 } }, findAction);
  const { entry } = ensureEntry(contexts, ctx('1_2', 'bacfa1cb'), { uuid: `${UUID}.hue` }, findAction);
  assert.equal(entry.settings.step, 30, 'the step the user chose follows the action');
});

test('forgetActionId never drops the context it is asked to keep', () => {
  const contexts = new Map();
  const keep = ctx('1_2', 'bacfa1cb');
  ensureEntry(contexts, ctx('1_0', 'bacfa1cb'), { uuid: `${UUID}.hue` }, findAction);
  ensureEntry(contexts, keep, { uuid: `${UUID}.hue` }, findAction);
  assert.equal(forgetActionId(contexts, 'bacfa1cb', keep), 1);
  assert.equal(contexts.size, 1);
  assert.equal(contexts.has(keep), true);
});

test('forgetActionId leaves other instances alone', () => {
  const contexts = new Map();
  ensureEntry(contexts, ctx('1_0', 'bacfa1cb'), { uuid: `${UUID}.hue` }, findAction);
  ensureEntry(contexts, ctx('1_2', 'other-id'), { uuid: `${UUID}.hue` }, findAction);
  ensureEntry(contexts, ctx('1_1', 'cct-id'), { uuid: `${UUID}.cct` }, findAction);
  forgetActionId(contexts, 'bacfa1cb', ctx('9_9', 'bacfa1cb'));
  assert.equal(contexts.size, 2, 'only the moved instance went away');
});

test('forgetActionId matches nothing without an actionid', () => {
  const contexts = new Map();
  ensureEntry(contexts, ctx('1_0', ''), { uuid: `${UUID}.hue` }, findAction);
  assert.equal(forgetActionId(contexts, '', 'other'), 0, 'an empty id must not match every key');
  assert.equal(contexts.size, 1);
});

// These two pin the merge `ensureEntry` performs. The service used to undo it immediately
// after, rebuilding the settings from the action defaults plus the message, which is what
// actually reset the untouched fields - see the handlers in app.js. That layer is not
// covered here: app.js opens a websocket to UlanziStudio on import and the SDK is not part
// of the repository, so it cannot be imported by a test. If the merge here is ever undone,
// the fix in app.js has to go with it.

test('a partial message leaves the settings it does not mention alone', () => {
  // The property inspector saves as the user edits, and a panel only ever sends the
  // fields it holds. The dial panels hold the range and the step as well as the preset
  // rows, so a message about one of them carries nothing about the others.
  //
  // Rebuilding the settings from the action defaults plus the message - which is what the
  // service used to do on top of this - reset every field the message left out. Saving a
  // preset list put the dial's own step back to its default, and editing the step put the
  // presets back to theirs.
  const contexts = new Map();
  const context = ctx('3_3', 'abc');

  ensureEntry(contexts, context, { uuid: `${UUID}.hue`, param: { step: 30, presets: '200,240' } }, findAction);
  const { entry } = ensureEntry(contexts, context, { uuid: `${UUID}.hue`, param: { step: 45 } }, findAction);

  assert.equal(entry.settings.step, 45, 'the field the message carried was applied');
  assert.equal(entry.settings.presets, '200,240', 'and the one it did not mention survived');
});

test('a partial message does not lose the preset names either', () => {
  // The names travel beside the values in one string, and they are what the row editor
  // shows back. Losing them alone would relabel every preset on the next draw.
  const contexts = new Map();
  const context = ctx('3_3', 'abc');

  ensureEntry(
    contexts,
    context,
    { uuid: `${UUID}.hue`, param: { presets: '200,240', presetNames: 'Sunset,Night' } },
    findAction
  );
  const { entry } = ensureEntry(contexts, context, { uuid: `${UUID}.hue`, param: { max: 300 } }, findAction);

  assert.equal(entry.settings.max, 300);
  assert.equal(entry.settings.presetNames, 'Sunset,Night');
});

test('a stale entry does not survive a removal, so the next placement starts clean', () => {
  const contexts = new Map();
  ensureEntry(contexts, ctx('3_3', 'abc'), { uuid: `${UUID}.hue`, param: { step: 30 } }, findAction);
  forget(contexts, ctx('3_3', 'abc'));
  // Whatever the host sends next, the previous action state is unreachable.
  assert.equal(contexts.has(ctx('3_3', 'abc')), false);
  assert.equal([...contexts.values()][0], undefined);
});
