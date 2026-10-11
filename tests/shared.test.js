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

const SOURCE = readFileSync(new URL('../plugin/property-inspector/shared.js', import.meta.url), 'utf8');

/** A control, with just the members a form read, a hydration or a picker need. */
function control(name, { value = '', tag = 'input' } = {}) {
  const node = {
    name,
    value,
    tagName: tag.toUpperCase(),
    type: 'text',
    className: '',
    dataset: {},
    style: {},
    children: [],
    options: [],
    appendChild(child) {
      node.children.push(child);
      node.options.push(child);
      return child;
    },
  };
  return node;
}

/** The two DOM shapes the bootstrap uses: a form with named controls, and lookups by id. */
function makeDom(formControls) {
  const byId = new Map();
  const form = {
    tagName: 'FORM',
    // The SDK walks form.elements; the correction pass does too.
    get elements() {
      return this.controls;
    },
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    listeners: {},
    controls: formControls,
  };
  for (const c of formControls) byId.set(c.name, c);
  // The ids the shared panel body writes to, which are not form controls.
  for (const id of ['detail', 'device-hint', 'error', 'link']) {
    if (!byId.has(id)) {
      const node = {
        ...control(id),
        textContent: '',
        style: {},
        // The connection dot is drawn as a child of the link element.
        querySelector: (sel) => (sel === '.dot' ? { className: '' } : { textContent: '' }),
      };
      byId.set(id, node);
    }
  }

  const document = {
    body: { appendChild() {}, dataset: { actionid: 'test.action' } },
    querySelector: (sel) => (sel === '#property-inspector' ? form : null),
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => ({
      ...control('', { tag }),
      value: '',
      appendChild() {},
      options: [],
    }),
  };
  const window = { addEventListener() {}, PI: null };
  return { window, document, form, byId };
}

/** A stand-in for the bundled Utils, faithful about the two functions that matter. */
function makeUtils() {
  return {
    getFormValue(form) {
      const out = {};
      for (const c of form.controls) if (c.name) out[c.name] = c.value;
      return out;
    },
    /**
     * Deliberately reproducing the SDK's own line,
     * `element.value = value ? value : ''`, which drops every falsy setting on the floor.
     * Faithful here matters more than correct: a stand-in that behaves better than the
     * real thing would hide the defect this file exists to pin.
     */
    setFormValue(settings, form) {
      for (const c of form.controls) {
        if (!c.name || !(c.name in settings)) continue;
        const value = settings[c.name];
        // A real input stringifies whatever it is given; the fake has to as well, or the
        // assertions below would be comparing a number to a string.
        c.value = String(value ? value : '');
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
  const { window, document, form, byId } = makeDom(formControls);
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
  return {
    PI: window.PI,
    form: handle.form,
    sent,
    handlers,
    text: (id) => {
      const node = byId.get(id);
      return node && node.textContent !== undefined ? node.textContent : node?.value;
    },
  };
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

test('a setting of zero reaches the field instead of arriving blank', () => {
  // Saturation's minimum and hue's minimum are both 0. The SDK writes
  // `element.value = value ? value : ''`, so they landed empty: the panel showed nothing,
  // which reads as "unset", and saving any other field wrote that emptiness back.
  const { form, handlers, text } = boot([
    control('min', { value: '' }),
    control('max', { value: '' }),
    control('step', { value: '' }),
  ]);

  handlers.settings({ settings: { min: 0, max: 100, step: 5 } });

  assert.equal(form.controls[0].value, '0', 'the zero is in the field');
  assert.equal(form.controls[1].value, '100', 'and the rest are untouched');
  assert.equal(form.controls[2].value, '5');
});

test('a setting of false reaches a choice that offers it', () => {
  // "Wrap around at the limits" is a select whose false option is the string "false".
  // Blanked, the select showed nothing at all and the next save wrote an empty setting.
  const { form, handlers } = boot([
    control('wrap', { value: '', tag: 'select' }),
    control('only', { value: '', tag: 'select' }),
  ]);

  handlers.settings({ settings: { wrap: false, only: true } });

  assert.equal(form.controls[0].value, 'false');
  assert.equal(form.controls[1].value, 'true');
});

test('an absent setting is not invented', () => {
  // The correction only puts back what the settings really carry: a field the settings
  // say nothing about has to stay as it was, or the panel would show a default the action
  // is not using.
  const { form, handlers } = boot([control('min', { value: '42' }), control('max', { value: '' })]);

  handlers.settings({ settings: { max: 80 } });

  assert.equal(form.controls[0].value, '42', 'the field the settings never mentioned is untouched');
  assert.equal(form.controls[1].value, '80');
});

test('the panel strips the row fields for the editor too', () => {
  // The one rule, now that both paths go through it. Two implementations of it is how the
  // automatic path and the Save button drifted apart in the first place.
  const { PI } = boot([control('p0_name', { value: 'Sunset' }), control('presets', { value: '3400:28' })]);
  assert.deepEqual(PI.withoutRowFields(PI.read()), { presets: '3400:28' });
});

test('the shared panel body shows the light, the picker and the error', () => {
  // `PI.panel` replaced the same four handlers copied into eight files. It is the only
  // thing standing between a panel and a blank one, so what it does is pinned here.
  const { PI, handlers, text } = boot([control('device', { value: '', tag: 'select' })]);
  PI.panel({ detail: (state) => `at ${state.brightness}%` });

  handlers.settings({ settings: { device: 'lamp-9' } });
  assert.equal(text('device'), 'lamp-9', 'the form was hydrated');

  handlers.toInspector({ payload: { event: 'state', state: { connected: true, name: 'Key', address: 'AA', brightness: 42 } } });
  assert.equal(text('detail'), 'at 42%', 'the detail line comes from the panel');

  handlers.toInspector({ payload: { event: 'state', state: { connecting: true, name: 'Key', address: 'AA' } } });
  handlers.toInspector({ payload: { event: 'registry', devices: [], activeId: '' } });
  assert.equal(
    text('device-hint'),
    'No light registered yet - use the Neewer Scan action to add one.',
    'and an empty registry says so instead of leaving a stale picker'
  );
});

test('the shared panel body has a default detail line', () => {
  const { PI, handlers, text } = boot([]);
  PI.panel();
  handlers.toInspector({ payload: { event: 'state', state: { connected: false, name: 'Key', address: 'AA:BB' } } });
  assert.equal(text('detail'), 'Key AA:BB');
});
