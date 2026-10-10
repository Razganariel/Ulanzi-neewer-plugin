/**
 * The line protocol with `nlink.exe`.
 *
 * The helper answers one line per command, in order, and nothing on the line says
 * which command it belongs to. That makes the request/reply pairing the fragile part of
 * the whole transport: get it wrong and a single slow write takes every write after it
 * down with it, with no error the operator can see. None of it needs a radio, so all of
 * it is tested here against a fake process.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { NativeLink } from '../plugin/service/core/native.js';

/** Stands in for the child process: records what was written, replies on demand. */
function fakeProcess() {
  const written = [];
  return {
    written,
    stdin: { write: (line) => written.push(line.trim()) },
    kill() {},
    stdout: { on() {} },
    stderr: { on() {} },
    on() {},
    once() {},
    removeListener() {},
  };
}

/** A link whose helper is already running, so requests can be issued directly. */
function readyLink() {
  const link = new NativeLink();
  link.proc = fakeProcess();
  link.started = true;
  return link;
}

const reply = (link, line) => link._onData(`${line}\n`);

test('a reply resolves the command that asked for it', async () => {
  const link = readyLink();
  const pending = link._request('open', 'AA:BB:CC:DD:EE:FF', 500);
  reply(link, 'open ok AA:BB:CC:DD:EE:FF Fake');
  assert.equal(await pending, 'open ok AA:BB:CC:DD:EE:FF Fake');
});

test('commands are answered in order, not by keyword', async () => {
  const link = readyLink();
  const first = link._request('write', 'AA 78 81', 1000);
  const second = link._request('write', 'BB 78 86', 500);
  reply(link, 'write ok 1');
  reply(link, 'write ok 2');
  assert.equal(await first, 'write ok 1');
  assert.equal(await second, 'write ok 2');
});

test('an error reply rejects its own command only', async () => {
  const link = readyLink();
  const bad = link._request('open', 'nope', 1000);
  const good = link._request('open', 'AA:BB:CC:DD:EE:FF', 500);
  reply(link, 'open.err unreachable');
  reply(link, 'open ok AA:BB:CC:DD:EE:FF');
  await assert.rejects(bad, /unreachable/);
  assert.equal(await good, 'open ok AA:BB:CC:DD:EE:FF');
});

test('a command that times out does not steal the next reply', async () => {
  // The bug this whole file exists for. The helper answers one line per command and
  // nothing identifies it, so the late reply of a command that already gave up has to
  // be swallowed by that command's own slot. Handing it to the next waiter resolved
  // that one with the wrong answer, and the real reply then timed out too: one slow
  // write broke every write after it until the service restarted.
  const link = readyLink();
  const slow = link._request('write', 'AA 78 81', 20);
  await assert.rejects(slow, /timed out/);

  const next = link._request('write', 'BB 78 86', 500);
  // The late reply to the first command, arriving now. It must be swallowed by the
  // slot that gave up, not handed to the command that is waiting.
  reply(link, 'write ok 1');

  // Its own reply is the one it must be given, and it resolves to that.
  reply(link, 'write ok 2');
  assert.equal(await next, 'write ok 2', 'and it got the answer to its own command');
});

test('several timeouts in a row still leave the queue usable', async () => {
  const link = readyLink();
  for (let i = 0; i < 3; i += 1) {
    const stalled = link._request('write', `AA 78 ${i}`, 15);
    await assert.rejects(stalled, /timed out/);
    reply(link, `write ok late ${i}`);
  }
  const live = link._request('write', 'BB 78 86', 500);
  reply(link, 'write ok final');
  assert.equal(await live, 'write ok final');
});

test('a notify is decoded into an address and a frame', () => {
  const link = readyLink();
  const seen = [];
  link.on('notify', (address, data) => seen.push([address, data.toString('hex').toUpperCase()]));
  reply(link, 'notify AA:BB:CC:DD:EE:FF 78 05 07 AA BB CC DD EE FF 64 00');
  assert.deepEqual(seen, [['AA:BB:CC:DD:EE:FF', '780507AABBCCDDEEFF6400']]);
});

test('a truncated notify is dropped instead of decoding into nonsense', () => {
  // With no second field, the old slicing handed the whole line to the frame decoder,
  // which stripped it to an empty buffer: a silent empty notification, indistinguishable
  // from the lamp having said nothing.
  const link = readyLink();
  const seen = [];
  link.on('notify', (address, data) => seen.push([address, data.length]));
  reply(link, 'notify AA:BB');
  reply(link, 'notify ');
  reply(link, 'notify');
  assert.deepEqual(seen, [], 'nothing was emitted');
});

test('a scanned device with a missing field is dropped too', () => {
  const link = readyLink();
  const seen = [];
  link.on('scanned', (...args) => seen.push(args));
  reply(link, 'device AA:BB');
  reply(link, 'device AA:BB notanumber Name');
  assert.deepEqual(seen, [['AA:BB', Number('notanumber'), 'Name']], 'only the usable one');
});

test('a line with no newline cannot grow without bound', () => {
  // The real hazard: a helper that stops sending newlines would grow this buffer for the
  // whole session. All this has to prove is that it does not.
  const link = readyLink();
  for (let i = 0; i < 200; i += 1) link._onData('x'.repeat(100));
  assert.ok(
    link.buffer.length <= 4096,
    `buffer held ${link.buffer.length} characters, so it is bounded rather than growing without limit`
  );
});

test('a reply after a discarded line is not merged into it', async () => {
  // Two lines, each with its own newline: the tail of the broken one and a real reply.
  // Without a ceiling the second would be glued to the first and never match a command.
  const link = readyLink();
  for (let i = 0; i < 100; i += 1) link._onData('x'.repeat(100));
  link._onData('\n');

  const pending = link._request('open', 'AA:BB:CC:DD:EE:FF', 500);
  reply(link, 'open ok AA:BB:CC:DD:EE:FF');
  assert.equal(await pending, 'open ok AA:BB:CC:DD:EE:FF');
});

test('a real reply arriving after a discarded line is read on its own', async () => {
  // The broken line ends, then a normal exchange follows. Nothing may leak across.
  const link = readyLink();
  for (let i = 0; i < 100; i += 1) link._onData('x'.repeat(100));
  reply(link, '\n'); // the newline that finally terminates the over-long line

  const pending = link._request('open', 'AA:BB:CC:DD:EE:FF', 500);
  reply(link, 'open ok AA:BB:CC:DD:EE:FF');
  assert.equal(await pending, 'open ok AA:BB:CC:DD:EE:FF');
});

test('a line split across two chunks is still one line', async () => {
  const link = readyLink();
  link._onData('open ok AA:BB:');
  link._onData('CC:DD:EE:FF\r\n');
  assert.equal(link.buffer, '', 'the partial line was completed and consumed');

  // The reply arrived before any request was made, so it had nobody to resolve. A new
  // request must still be answered by its own reply, not left waiting.
  const pending = link._request('open', 'AA:BB:CC:DD:EE:FF', 500);
  reply(link, 'open ok second');
  assert.equal(await pending, 'open ok second');
});

test('a reply nobody is waiting for is ignored', () => {
  const link = readyLink();
  assert.doesNotThrow(() => reply(link, 'open ok stray'));
  assert.equal(link.pending.length, 0);
});

test('stopping rejects every command still in flight', async () => {
  const link = readyLink();
  const pending = link._request('scan', '6000', 5000);
  link.stop();
  await assert.rejects(pending, /stopped/);
});

test('stopping clears the timer of a command it rejects', async () => {
  // The command is already finished, yet its timer was left armed on every handle it
  // had, so the service stayed alive for the full timeout it had already given up on.
  const realSet = global.setTimeout;
  const realClear = global.clearTimeout;
  const armed = new Set();
  global.setTimeout = (fn, ms, ...rest) => {
    const timer = realSet(fn, ms, ...rest);
    armed.add(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    armed.delete(timer);
    return realClear(timer);
  };

  try {
    const link = readyLink();
    const pending = link._request('scan', '6000', 30000);
    const settled = assert.rejects(pending, /stopped/);
    // The only timer this request owns, captured before `stop` adds its own kill timer.
    const owned = [...armed];

    await link.stop();
    await settled;
    const stillArmed = owned.filter((timer) => armed.has(timer));
    assert.equal(stillArmed.length, 0, `a rejected request left ${stillArmed.length} timeout(s) armed`);
  } finally {
    for (const timer of armed) realClear(timer);
    global.setTimeout = realSet;
    global.clearTimeout = realClear;
  }
});

test('the link emits a raw line for anything, including ones it cannot place', () => {
  // The readiness handshake listens here, so every line has to be emitted, not only the
  // ones that resolve a command. A line that fires nothing is a line nobody can account
  // for when the helper says something unexpected.
  const link = readyLink();
  const lines = [];
  link.on('_line', (line) => lines.push(line));
  reply(link, 'garbage from the helper');
  reply(link, 'notify AA:BB');
  assert.deepEqual(lines, ['garbage from the helper', 'notify AA:BB']);
});

test('a link with no helper running rejects rather than hangs', async () => {
  const link = new NativeLink();
  await assert.rejects(link._request('open', 'AA', 1000), /not running/);
});

test('the fake really stands in: a fresh link is not running', () => {
  // Guards the premise of this file. If the constructor ever started the helper, every
  // test here would be opening a real BLE session.
  const link = new NativeLink();
  assert.equal(link.proc, null);
  assert.equal(link instanceof EventEmitter, true);
});
