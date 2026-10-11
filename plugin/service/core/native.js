/**
 * Node side of the native WinRT transport.
 *
 * `nlink.exe` is a small C++/WinRT helper shipped with the plugin. It talks to
 * Windows Bluetooth directly, which avoids the npm native addon entirely: no
 * .NET runtime, no compiler, nothing to rebuild on the user's machine. It is a
 * long-lived child process speaking one line protocol over stdin/stdout.
 *
 * The helper is driven by address, not by advertisements: Windows can open a
 * paired fixture directly. That is what removes the advertisement hunt the
 * previous noble-based transport needed.
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXE = path.resolve(HERE, '..', '..', 'native', 'nlink.exe');

/** Lines the helper emits on its own initiative, never as a command reply. */
const EVENT_PREFIXES = ['notify ', 'device '];

const COMMAND_TIMEOUTS = {
  scan: 30000,
  open: 45000,
  write: 10000,
  close: 5000,
  status: 5000,
};

/**
 * Longest partial line kept while waiting for its newline.
 *
 * A reply is one short word, an event is an address plus a frame, so a few hundred
 * characters is already generous. Anything past that is a helper that has lost the
 * thread, and buffering it would cost a little memory on every line for the life of
 * the session.
 */
const MAX_LINE = 4096;

export class NativeLink extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.pending = [];
    this.buffer = '';
    /** True while the tail of an over-long line is still being thrown away. */
    this.discarding = false;
    this.starting = null;
    this.dead = null;
  }

  async start() {
    if (this.proc) return;
    if (this.starting) return this.starting;

    if (process.platform !== 'win32') {
      throw new Error(
        `The Neewer transport talks to Windows Bluetooth and is not available on ${process.platform}`
      );
    }
    if (!fs.existsSync(EXE)) {
      throw new Error(
        `Native Bluetooth helper missing at ${EXE}. Reinstall the plugin; this file ships with it`
      );
    }

    this.starting = new Promise((resolve, reject) => {
      const child = spawn(EXE, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      this.proc = child;

      let settled = false;
      const fail = (err) => {
        this.dead = err;
        for (const entry of this.pending.splice(0)) entry.cancel(err);
        this.proc = null;
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => this._onData(chunk));

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => this.emit('diagnostic', String(chunk).trim()));

      child.on('error', fail);
      child.on('exit', (code, signal) => {
        const err = new Error(`Native Bluetooth helper exited (code ${code}, signal ${signal})`);
        this.dead = err;
        for (const entry of this.pending.splice(0)) entry.cancel(err);
        this.proc = null;
        if (!settled) {
          settled = true;
          reject(err);
        }
        this.emit('link', false, err);
      });

      const onReady = (line) => {
        if (line !== 'ready') return;
        this.removeListener('_line', onReady);
        if (settled) return;
        settled = true;
        resolve(this);
      };
      this.on('_line', onReady);
    });

    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  _onData(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      // The line right after a purge is the tail of a line that was already thrown away,
      // so it is skipped rather than parsed. Only the first one: anything after it is a
      // fresh, complete line and must be read, which is what keeps a real reply from
      // being mistaken for debris.
      if (this.discarding) {
        this.discarding = false;
      } else if (line) {
        this._onLine(line);
      }
    }
    // The helper is line oriented, so a line without its newline means something is
    // wrong upstream, and without a ceiling the partial line would grow for the life of
    // the session. Dropping the buffer alone is not enough: the ceiling only trips once
    // every few chunks, so the surviving tail would still be glued to the next reply.
    if (this.buffer.length > MAX_LINE) {
      this.buffer = '';
      this.discarding = true;
    }
  }

  _onLine(line) {
    this.emit('_line', line);

    for (const prefix of EVENT_PREFIXES) {
      if (line.startsWith(prefix)) {
        const body = line.slice(prefix.length);
        const space = body.indexOf(' ');
        // A truncated event carries no address and no payload. Handing the whole line to
        // the frame decoder instead would produce a silent empty notification, which
        // reads as "the lamp said nothing" rather than as a protocol error.
        if (space <= 0) return;
        if (prefix === 'notify ') {
          this.emit('notify', body.slice(0, space), hexToBuffer(body.slice(space + 1)));
        } else {
          const second = body.indexOf(' ', space + 1);
          if (second <= 0) return;
          this.emit('scanned', body.slice(0, space), Number(body.slice(space + 1, second)), body.slice(second + 1));
        }
        return;
      }
    }

    // One line, one entry. A command that already timed out is still at the head on
    // purpose: it swallows its own late reply so the next request is not resolved with
    // it. Exactly one entry is consumed per line, and `return` after an abandoned one:
    // looping would hand the very line that was supposed to be discarded to the entry
    // behind it, which is the bug all over again.
    const entry = this.pending.shift();
    if (!entry || entry.abandoned) return;
    entry.resolve(line);
  }

  /**
   * Send one command and wait for its reply line.
   *
   * The helper answers one line per command, in order, and there is nothing on the
   * line to say which command it belongs to. A command that timed out therefore leaves
   * a reply in flight: if that late line were handed to the next waiting request, it
   * would resolve with the wrong answer and the real one would then time out too, so a
   * single slow write would break every write after it until the service restarts.
   *
   * A timed-out entry is therefore kept, marked as abandoned, and swallows its own
   * reply. The queue stays aligned and the next command is answered correctly.
   */
  _request(command, payload, timeoutMs) {
    if (!this.proc) return Promise.reject(this.dead || new Error('Native Bluetooth helper is not running'));
    const line = `${command} ${payload}`.trim();
    return new Promise((resolve, reject) => {
      const entry = { resolve: null, reject, command, abandoned: false, timer: null };
      entry.timer = setTimeout(() => {
        // Left in place on purpose: see above. The entry is only closed if the helper
        // never answers, which `stop()` handles for every pending entry at once.
        entry.abandoned = true;
        reject(new Error(`Native Bluetooth helper timed out on "${line}"`));
      }, timeoutMs);
      // Every path that closes an entry must drop its timer. A request rejected by
      // `stop()` or by the helper dying would otherwise keep the timer armed, and the
      // service's event loop would stay alive for the full timeout after it had already
      // given up on that command.
      entry.cancel = (err) => {
        clearTimeout(entry.timer);
        entry.reject(err);
      };
      entry.resolve = (reply) => {
        clearTimeout(entry.timer);
        entry.abandoned = true;
        const space = reply.indexOf(' ');
        const head = space < 0 ? reply : reply.slice(0, space);
        if (head.startsWith(`${command}.err`) || head.startsWith('err')) {
          reject(new Error(reply));
        } else {
          resolve(reply);
        }
      };
      this.pending.push(entry);
      this.proc.stdin.write(`${line}\n`);
    });
  }

  async scan(durationMs) {
    const found = new Map();
    const collect = (address, rssi, name) => {
      if (address && name) found.set(address, { address, rssi, name });
    };
    this.on('scanned', collect);
    try {
      await this._request('scan', String(durationMs), COMMAND_TIMEOUTS.scan);
    } finally {
      this.removeListener('scanned', collect);
    }
    return [...found.values()];
  }

  async open(address) {
    const reply = await this._request('open', address, COMMAND_TIMEOUTS.open);
    const parts = reply.split(' ');
    return { address: parts[1] || address, name: parts[2] || '' };
  }

  async write(address, frame) {
    await this._request('write', `${address} ${frame.toString('hex').toUpperCase().replace(/(..)(?=.)/g, '$1 ')}`, COMMAND_TIMEOUTS.write);
  }

  async close(address) {
    await this._request('close', address, COMMAND_TIMEOUTS.close);
  }

  async status(address) {
    const reply = await this._request('status', address, COMMAND_TIMEOUTS.status);
    const parts = reply.split(' ');
    return { connection: Number(parts[1]), name: parts[2] || '' };
  }

  async stop() {
    const child = this.proc;
    if (!child) return;
    this.proc = null;
    for (const entry of this.pending.splice(0)) {
      entry.cancel(new Error('Native Bluetooth helper stopped'));
    }
    try {
      child.stdin.write('quit\n');
    } catch {
      /* pipe already gone */
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* already dead */
        }
        resolve();
      }, 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function hexToBuffer(text) {
  const clean = text.replace(/[^0-9A-Fa-f]/g, '');
  const out = Buffer.alloc(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}