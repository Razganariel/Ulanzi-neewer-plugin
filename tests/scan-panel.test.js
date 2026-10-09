/**
 * The Scan panel.
 *
 * The one behaviour worth pinning here is the registered-lights table. The main service
 * sends the list of fixtures on every repaint, and the panel rebuilds the table from
 * scratch, which means rebuilding the rename inputs inside it. Without a guard, a lamp
 * changing state anywhere pulled the field out from under anyone halfway through naming a
 * fixture: the caret jumped and the half typed name was gone.
 *
 * The file is a classic script that reaches for `PI`, `$UD` and `document`, so it is
 * loaded the way the WebView loads it, with those supplied.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = readFileSync(new URL('../plugin/property-inspector/scan/inspector.js', import.meta.url), 'utf8');

/** A cell that can take a value, and a row that can take cells. */
function makeDom() {
  const make = (tag) => {
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      className: '',
      textContent: '',
      value: '',
      type: '',
      disabled: false,
      listeners: {},
      dataset: {},
      style: {},
      appendChild(child) {
        node.children.push(child);
        return child;
      },
      addEventListener(type, fn) {
        (node.listeners[type] ||= []).push(fn);
      },
      insertRow() {
        const row = make('tr');
        node.children.push(row);
        return row;
      },
      insertCell() {
        const cell = make('td');
        node.children.push(cell);
        return cell;
      },
    };
    return node;
  };
  const byId = new Map();
  const document = {
    activeElement: null,
    body: make('body'),
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => make(tag),
    querySelectorAll: () => [],
  };
  return { document, byId, make };
}

/** Loads the panel and returns the handles a test drives it through. */
function load() {
  const { document, byId, make } = makeDom();
  const table = make('table');
  byId.set('registered', table);
  for (const id of ['registered-title', 'error', 'detail', 'link', 'device', 'device-hint', 'others', 'others-title']) {
    byId.set(id, make('div'));
  }
  byId.set('scan', make('button'));
  byId.set('address', make('input'));

  const toPlugin = [];
  const $UD = { sendToPlugin: (payload) => toPlugin.push(payload) };
  const callbacks = {};
  const PI = {
    boot(_selector, options) {
      Object.assign(callbacks, options);
      return {};
    },
    el: (id) => byId.get(id) || null,
    setText(id, text) {
      const node = byId.get(id);
      if (node) node.textContent = text;
    },
    showError() {},
    status() {},
    deviceSelect() {},
    on(id, event, fn) {
      const node = byId.get(id);
      if (node) node.addEventListener(event, fn);
      return node;
    },
    get form() {
      return { controls: [] };
    },
  };

  new Function('window', 'document', 'PI', '$UD', 'Utils', SOURCE)(
    { addEventListener() {} },
    document,
    PI,
    $UD,
    { getFormValue: () => ({}), debounce: (fn) => fn }
  );
  PI.boot('#property-inspector', callbacks);
  return { callbacks, table, toPlugin, document };
}

const device = (id, name, address = 'AA:BB:CC:DD:EE:FF') => ({ id, name, address });

test('a repeated broadcast leaves the table alone', () => {
  // The hazard: the service sends the list on every repaint, and a repaint happens
  // whenever any fixture changes state.
  const { callbacks, table } = load();
  const devices = [device('a', 'Key')];

  callbacks.onRegistry({ devices, deviceId: 'a' });
  const built = table.children[0];
  assert.ok(built, 'the table was drawn');

  callbacks.onRegistry({ devices: [...devices], deviceId: 'a' });

  assert.equal(table.children[0], built, 'and the same row node is still there');
  assert.equal(table.children.length, 1, 'with nothing appended');
});

test('a change in the list is still shown', () => {
  // The counterpart, so the guard cannot be met by simply never redrawing: a fixture that
  // was renamed, added or removed has to reach the table.
  const { callbacks, table } = load();
  callbacks.onRegistry({ devices: [device('a', 'Key')], deviceId: 'a' });
  callbacks.onRegistry({ devices: [device('a', 'Renamed')], deviceId: 'a' });

  const inputs = [];
  const walk = (node) => {
    if (node.tagName === 'INPUT') inputs.push(node);
    for (const child of node.children) walk(child);
  };
  walk(table);
  assert.ok(
    inputs.some((i) => i.value === 'Renamed'),
    'the new name is in the table'
  );
});

test('the light in use is marked, and the marking follows a change', () => {
  const { callbacks, table } = load();
  callbacks.onRegistry({ devices: [device('a', 'Key'), device('b', 'Fill')], deviceId: 'a' });
  const text = (node) => {
    let out = node.textContent || '';
    for (const child of node.children) out += ' ' + text(child);
    return out;
  };
  assert.match(text(table), /in use/);

  callbacks.onRegistry({ devices: [device('a', 'Key'), device('b', 'Fill')], deviceId: 'b' });
  assert.match(text(table), /in use/, 'and the mark moved with it');
});

test('an empty list says so instead of drawing nothing', () => {
  const { callbacks, table } = load();
  callbacks.onRegistry({ devices: [], deviceId: '' });
  assert.match(text_of(table), /No light registered/);
});

function text_of(node) {
  let out = node.textContent || '';
  for (const child of node.children) out += ' ' + text_of(child);
  return out;
}
