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

export class NativeLink extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.pending = [];
    this.buffer = '';
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
        for (const entry of this.pending.splice(0)) entry.reject(err);
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
        for (const entry of this.pending.splice(0)) entry.reject(err);
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
      if (line) this._onLine(line);
    }
  }

  _onLine(line) {
    this.emit('_line', line);

    for (const prefix of EVENT_PREFIXES) {
      if (line.startsWith(prefix)) {
        if (prefix === 'notify ') {
          const space = line.indexOf(' ', 7);
          this.emit('notify', line.slice(7, space), hexToBuffer(line.slice(space + 1)));
        } else {
          const first = line.indexOf(' ', 7);
          const second = line.indexOf(' ', first + 1);
          this.emit(
            'scanned',
            line.slice(7, first),
            Number(line.slice(first + 1, second)),
            line.slice(second + 1)
          );
        }
        return;
      }
    }

    const entry = this.pending.shift();
    if (!entry) return;
    entry.resolve(line);
  }

  /** Send one command and wait for its reply line. */
  _request(command, payload, timeoutMs) {
    if (!this.proc) return Promise.reject(this.dead || new Error('Native Bluetooth helper is not running'));
    const line = `${command} ${payload}`.trim();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const at = this.pending.findIndex((entry) => entry.resolve === onLine);
        if (at >= 0) this.pending.splice(at, 1);
        reject(new Error(`Native Bluetooth helper timed out on "${line}"`));
      }, timeoutMs);
      const onLine = (reply) => {
        clearTimeout(timer);
        const space = reply.indexOf(' ');
        const head = space < 0 ? reply : reply.slice(0, space);
        if (head.startsWith(`${command}.err`) || head.startsWith('err')) {
          reject(new Error(reply));
        } else {
          resolve(reply);
        }
      };
      this.pending.push({ resolve: onLine, reject });
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
      entry.reject(new Error('Native Bluetooth helper stopped'));
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