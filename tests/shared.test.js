/**
 * The property inspector bootstrap every panel shares.
 *
 * `shared.js` is what connects a panel, hydrates it from the settings and pushes changes
 * back. Nothing tested it, which is how a defect lived there unnoticed: reading a form
 * collects every named control it holds, and the preset rows are named after their
 * position, so an automatic save wrote `p0_name`, `p0_value` and the rest into the
 * action's settings. The service merges and stores them, and nothing ever removed them,
 * because deleting a row only lowers the highest index.
 *
 * The file is a classic script that reaches for `window`, `document`, `$UD` and `Utils`,
 * so it is loaded the way the WebView loads it, with those four supplied.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = readFileSync(new URL('../plugin/property-inspector/shared.js', import.meta.url), 'utf8');

/** A control, with just the members a form read and a hydration need. */
function control(name, { value = '', tag = 'input' } = {}) {
  return { name, value, tagName: tag.toUpperCase(), type: 'text', className: '', dataset: {}, style: {}, children: [] };
}

/** The two DOM shapes the bootstrap uses: a form with named controls, and lookups by id. */
function makeDom(formControls) {
  const byId = new Map();
  const form = {
    tagName: 'FORM',
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    listeners: {},
    controls: formControls,
  };
  for (const c of formControls) byId.set(c.name, c);

  const document = {
    body: { appendChild() {}, dataset: { actionid: 'test.action' } },
    querySelector: (sel) => (sel === '#property-inspector' ? form : null),
    getElementById: (id) => byId.get(id) || null,
    createElement: () => ({ style: {}, className: '', textContent: '', appendChild() {} }),
  };
  const window = { addEventListener() {}, PI: null };
  return { window, document, form };
}

/** A stand-in for the bundled Utils, faithful about the two functions that matter. */
function makeUtils() {
  return {
    getFormValue(form) {
      const out = {};
      for (const c of form.controls) if (c.name) out[c.name] = c.value;
      return out;
    },
    setFormValue(settings, form) {
      for (const c of form.controls) {
        if (c.name && settings[c.name] !== undefined) c.value = String(settings[c.name]);
      }
    },
    debounce: (fn) => {
      let timer = null;
      return (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), 150);
      };
    },
  };
}

/** Boots the bootstrap over a form, and returns what a panel would see. */
function boot(formControls) {
  const { window, document, form } = makeDom(formControls);
  const Utils = makeUtils();
  const sent = [];
  /** The callbacks the panel registered, so a test can play the part of the host. */
  const handlers = {};
  const $UD = {
    connect() {},
    on: (event, fn) => (handlers[event] = fn),
    getSettings() {},
    sendToPlugin() {},
    onParamFromApp: (fn) => (handlers.paramFromApp = fn),
    onDidReceiveSettings: (fn) => (handlers.settings = fn),
    onSendToPropertyInspector: (fn) => (handlers.toInspector = fn),
    sendParamFromPlugin: (params) => sent.push(params),
    logMessage() {},
  };
  new Function('window', 'document', 'Utils', '$UD', 'console', SOURCE)(
    window,
    document,
    Utils,
    $UD,
    { warn() {}, log() {} }
  );
  const handle = window.PI.boot('#property-inspector', {});
  // `boot` hands back the form and the debounced sender; the panel surface is the PI
  // object itself, which is what an inspector script reaches for.
  return { PI: window.PI, form: handle.form, sent, handlers };
}

/** Fires the form's change handler, as the browser would. */
function change(form) {
  for (const fn of form.listeners.change || []) fn({ target: { parentElement: null, classList: { contains: () => false } } });
}

const settle = () => new Promise((r) => setTimeout(r, 250));

test('an automatic save never carries the preset row inputs', async () => {
  // The leak: these are inputs of the form like any other, so a read collects them, and
  // they were stored under names nothing ever reads.
  const { form, sent } = boot([
    control('device', { value: 'lamp-1', tag: 'select' }),
    control('step', { value: '5', tag: 'select' }),
    control('p0_name', { value: 'Sunset' }),
    control('p0_value', { value: '4500' }),
    control('p0_third', { value: '16' }),
  ]);

  change(form);
  await settle();

  assert.equal(sent.length, 1, 'the change was saved');
  const saved = sent[0];
  assert.deepEqual(
    Object.keys(saved).filter((k) => /^p\d+_/.test(k)),
    [],
    'no row field was persisted'
  );
  assert.equal(saved.device, 'lamp-1', 'and the settings that were edited still are');
  assert.equal(saved.step, '5');
});

test('the panel is hydrated from the settings the host sends', () => {
  const { form, handlers } = boot([
    control('device', { value: '', tag: 'select' }),
    control('step', { value: '', tag: 'select' }),
  ]);

  handlers.settings({ settings: { device: 'lamp-2', step: '10' } });

  assert.equal(form.controls[0].value, 'lamp-2', 'the panel shows what was stored');
  assert.equal(form.controls[1].value, '10');
});

test('the panel is also hydrated from a param coming back from the host', () => {
  // A panel is often opened after the action already ran, so this is how it learns its
  // settings rather than showing the HTML defaults.
  const { form, handlers } = boot([control('device', { value: '', tag: 'select' })]);

  handlers.paramFromApp({ param: { device: 'lamp-3' } });

  assert.equal(form.controls[0].value, 'lamp-3');
});

test('an explicit push is not coalesced away by a pending automatic save', async () => {
  // The preset rows are saved by their own button. That went through the same debounce as
  // the automatic path, so a Save landing within 150 ms of another change replaced the
  // queued one: the automatic change was dropped instead, and the two edits were never
  // both applied.
  const { PI, form, sent } = boot([
    control('presets', { value: '3400:28' }),
    control('device', { value: 'lamp-1' }),
  ]);

  change(form); // an automatic change, now queued
  PI.push({ presets: '5600:70', presetNames: 'Daylight' }); // and a deliberate save
  await settle();

  assert.ok(
    sent.some((s) => s.presets === '5600:70'),
    'the deliberate save went out'
  );
  assert.ok(
    sent.some((s) => s.presets === '3400:28' && s.device === 'lamp-1'),
    'and the queued automatic change went out too, not replaced by the save'
  );
});

test('reading the form still reports the row fields to the editor', () => {
  // `PI.read` is what the preset editor saves from, and it deliberately stays a raw read:
  // the editor strips the row fields itself, on the one path where their values are
  // actually meaningful. Only the automatic path has to be protected.
  const { PI } = boot([control('p0_name', { value: 'Sunset' }), control('presets', { value: '3400:28' })]);
  const read = PI.read();
  assert.equal(read.p0_name, 'Sunset', 'the editor can still see them');
  assert.equal(read.presets, '3400:28');
});
