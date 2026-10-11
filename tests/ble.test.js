/**
 * The native helper process, from the transport's point of view.
 *
 * `nlink.exe` exits when its stdin closes and at no other signal: not on `quit` alone if
 * the pipe is already gone, and never because the BLE link was closed. That makes the
 * transport responsible for ending it, and it is the reason a leak here was invisible
 * for so long: the plugin worked perfectly while leaving a process per scan behind.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NeewerTransport } from '../plugin/service/core/ble.js';

/** A stand-in for NativeLink, recording what the transport does to it. */
function fakeLink() {
  const calls = [];
  return {
    calls,
    async start() {
      return 'ready';
    },
    async open(address) {
      calls.push(`open ${address}`);
      return { address, name: 'Fake' };
    },
    async write() {
      calls.push('write');
    },
    async close(address) {
      calls.push(`close ${address}`);
    },
    async scan() {
      return [];
    },
    async stop() {
      calls.push('stop');
    },
  };
}

test('disposing the transport stops the helper process', async () => {
  const transport = new NeewerTransport();
  const link = fakeLink();
  transport.link = link;
  transport.address = 'AA:BB:CC:DD:EE:FF';
  transport.connected = true;

  await transport.dispose();

  assert.deepEqual(link.calls, ['close AA:BB:CC:DD:EE:FF', 'stop'], 'the link is closed, then the process is ended');
  assert.equal(transport.link, null, 'the dead helper is not kept');
  assert.equal(transport.connected, false);
});

test('disconnecting alone leaves the helper running', async () => {
  // The distinction the leak came from: this is what a reconnect and a moved address
  // do, and it must not cost a process.
  const transport = new NeewerTransport();
  const link = fakeLink();
  transport.link = link;
  transport.address = 'AA:BB:CC:DD:EE:FF';
  transport.connected = true;

  await transport.disconnect();

  assert.deepEqual(link.calls, ['close AA:BB:CC:DD:EE:FF']);
  assert.equal(transport.link, link, 'the same helper is kept for the next connection');
});

test('a disposed transport can be used again', async () => {
  // Otherwise disposing would be a one-way door, and a light that is stopped then moved
  // to another address could never talk to a fixture again.
  const transport = new NeewerTransport();
  const first = fakeLink();
  transport.link = first;

  await transport.dispose();
  assert.equal(transport.link, null);

  // `ready` builds a fresh helper the next time something needs one.
  assert.notEqual(transport.link, first);
  await transport.dispose();
});

test('disposing a transport that never started is harmless', async () => {
  const transport = new NeewerTransport();
  assert.equal(transport.link, null);
  await assert.doesNotReject(transport.dispose());
});
