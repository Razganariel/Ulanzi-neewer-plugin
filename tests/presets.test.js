/**
 * The preset row editor.
 *
 * This is the only part of a property inspector with real logic in it, and it is
 * where a wrong answer is invisible until the light comes up the wrong colour: it
 * turns typed rows into the single string the service reads. The DOM it touches is a
 * table body, a status line and an add button, so it is loaded here against the
 * smallest host that can run it rather than left untested.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as hue from '../plugin/service/actions/hue.js';

const SOURCE = readFileSync(new URL('../plugin/property-inspector/presets.js', import.meta.url), 'utf8');

/**
 * Enough of the DOM for the editor: element creation, appending, removal, and the two
 * query shapes it uses (descendants of a type, and descendants of a type carrying a
 * dataset field). Built by hand rather than pulled in as a dependency because the
 * editor is careful to use no DOM feature beyond this list.
 */
function miniDom() {
  const make = (tagName) => {
    const node = {
      tagName: tagName.toUpperCase(),
      children: [],
      parent: null,
      className: '',
      value: '',
      type: '',
      name: '',
      dataset: {},
      style: {},
      listeners: {},
      attrs: {},
      appendChild(child) {
        child.parent = node;
        node.children.push(child);
        return child;
      },
      remove() {
        if (!node.parent) return;
        node.parent.children = node.parent.children.filter((c) => c !== node);
        node.parent = null;
      },
      addEventListener(type, fn) {
        (node.listeners[type] ||= []).push(fn);
      },
      setAttribute(name, value) {
        node.attrs[name] = String(value);
      },
      getAttribute(name) {
        return node.attrs[name] ?? null;
      },
      click() {
        for (const fn of node.listeners.click || []) fn();
      },
      focus() {},
      descendants() {
        return node.children.flatMap((c) => [c, ...c.descendants()]);
      },
      querySelector(selector) {
        const tag = selector.split('[')[0].trim();
        const field = /data-field="([^"]+)"/.exec(selector)?.[1];
        return (
          node
            .descendants()
            .find((n) => (!tag || n.tagName === tag.toUpperCase()) && (!field || n.dataset.field === field)) || null
        );
      },
      querySelectorAll(selector) {
        const tag = selector.split('[')[0].trim();
        const field = /data-field="([^"]+)"/.exec(selector)?.[1];
        return node
          .descendants()
          .filter((n) => (!tag || n.tagName === tag.toUpperCase()) && (!field || n.dataset.field === field));
      },
      // Setting textContent replaces every child, which is what the editor relies on to
      // clear the table body before redrawing it. Modelling that here is what makes
      // the "an echo does not rebuild" test mean anything.
      get textContent() {
        return node._text;
      },
      set textContent(value) {
        node._text = String(value);
        for (const child of node.children) child.parent = null;
        node.children = [];
      },
      _text: '',
    };
    return node;
  };

  const registry = new Map();
  for (const id of ['preset-rows', 'preset-status', 'preset-add']) {
    const node = id === 'preset-rows' ? make('tbody') : make(id === 'preset-add' ? 'button' : 'p');
    node.id = id;
    registry.set(id, node);
  }

  return {
    document: {
      getElementById: (id) => registry.get(id) ?? null,
      createElement: (tag) => make(tag),
      // The icon buttons are built with the SVG namespace, so the host has to hand
      // out SVG elements rather than HTML ones.
      createElementNS: (_ns, tag) => make(tag),
    },
    registry,
  };
}

const COLOUR = {
  value: { label: 'Hue', name: 'Colour', unit: '°', min: 0, max: 359 },
  third: { label: 'Saturation', unit: '%', min: 0, max: 100 },
};
const SCENE = {
  value: { label: 'Temperature', name: 'Scene', unit: 'K', min: 2500, max: 8500 },
  third: { label: 'Brightness', unit: '%', min: 1, max: 100 },
};
// A preset that is a single value, the shape the brightness and saturation dials use.
const VALUE_ONLY = {
  value: { label: 'Brightness', name: 'Value', unit: '%', min: 1, max: 100 },
};

/** Loads the editor against a fresh DOM and captures what it pushes. */
function mount(spec = SCENE) {
  const dom = miniDom();
  const sent = [];
  // PI.read stands in for Utils.getFormValue, which collects every named control in
  // the form - the row inputs included, which is exactly what has to be stripped.
  const PI = {
    push: (params) => sent.push(params),
    read: () => {
      const raw = { device: 'abc' };
      for (const input of dom.registry.get('preset-rows').descendants()) {
        if (input.tagName === 'INPUT') raw[input.name] = input.value;
      }
      return raw;
    },
    // The rule itself lives in shared.js, which a browser loads before this file. The
    // editor calls it rather than keeping its own copy, so a stand-in has to be the same
    // rule rather than a different one.
    withoutRowFields: (settings) => {
      const out = { ...settings };
      for (const key of Object.keys(out)) {
        if (/^p\d+_(name|value|third)$/.test(key)) delete out[key];
      }
      return out;
    },
  };
  // PI is passed as its own binding because the editor reaches for the bare global,
  // which in a browser is the same object as window.PI.
  const window = { PI };
  new Function('window', 'document', 'PI', SOURCE)(window, dom.document, PI);
  const editor = window.presetEditor(spec);
  return { editor, sent, dom };
}

/** The row inputs as {name, value} for the nth row. */
function rowInputs(dom, index) {
  return dom.registry
    .get('preset-rows')
    .querySelectorAll('tr')
    [index].querySelectorAll('input')
    .map((input) => ({ field: input.dataset.field, value: input.value }));
}

function type(dom, index, field, value) {
  const input = dom.registry
    .get('preset-rows')
    .querySelectorAll('tr')
    [index].querySelector(`[data-field="${field}"]`);
  input.value = value;
}

test('stored presets come back as one editable row each', () => {
  const { editor, dom } = mount();
  editor.render({ presets: '3400:28,6500:100', presetNames: 'Candle,Cold blue' });
  assert.deepEqual(rowInputs(dom, 0), [
    { field: 'name', value: 'Candle' },
    { field: 'value', value: '3400' },
    { field: 'third', value: '28' },
  ]);
  assert.deepEqual(rowInputs(dom, 1), [
    { field: 'name', value: 'Cold blue' },
    { field: 'value', value: '6500' },
    { field: 'third', value: '100' },
  ]);
});

test('a bare entry shows an empty third cell, not a zero', () => {
  const { editor, dom } = mount();
  editor.render({ presets: '120,240', presetNames: '' });
  assert.equal(rowInputs(dom, 0)[2].value, '');
  assert.equal(rowInputs(dom, 1)[2].value, '');
});

test('filling a row and saving writes the string the service reads', () => {
  const { editor, dom, sent } = mount();
  editor.render({ presets: '', presetNames: '' });
  type(dom, 0, 'name', 'Candle');
  type(dom, 0, 'value', '3400');
  type(dom, 0, 'third', '28');
  assert.equal(editor.save(), true);
  assert.equal(sent.at(-1).presets, '3400:28');
  assert.equal(sent.at(-1).presetNames, 'Candle');
});

test('an unnamed preset is stored under a generated name', () => {
  // The name list travels positionally, so a blank would slide every later name onto
  // the wrong preset. Each panel picks its own word: a colour is filed as "Colour 2",
  // a measured scene as "Scene 2".
  const { editor, sent } = mount(COLOUR);
  editor.render({ presets: '0,120', presetNames: 'Red,' });
  assert.equal(editor.save(), true);
  assert.equal(sent.at(-1).presetNames, 'Red,Colour 2');

  const scene = mount(SCENE);
  scene.editor.render({ presets: '3400,4500', presetNames: 'Candle,' });
  scene.editor.save();
  assert.equal(scene.sent.at(-1).presetNames, 'Candle,Scene 2');
});

test('a value out of range is refused and says which preset is wrong', () => {
  const { editor, dom, sent } = mount();
  editor.render({ presets: '3400,6500', presetNames: 'A,B' });
  type(dom, 1, 'value', '99999');
  assert.equal(editor.save(), false, 'nothing is sent while a cell is wrong');
  assert.equal(sent.length, 0);
  assert.match(dom.registry.get('preset-status').textContent, /Preset 2/);
  assert.match(dom.registry.get('preset-status').textContent, /between 2500 and 8500/);
});

test('a name holding a comma is refused', () => {
  // Names travel in one comma separated list; a comma inside one would split it and
  // shift every name after it.
  const { editor, dom, sent } = mount();
  editor.render({ presets: '3400', presetNames: 'A' });
  type(dom, 0, 'name', 'Cold, blue');
  assert.equal(editor.save(), false);
  assert.equal(sent.length, 0);
  assert.match(dom.registry.get('preset-status').textContent, /comma/);
});

test('an empty third cell is accepted and means "keep the current value"', () => {
  const { editor, dom, sent } = mount();
  editor.render({ presets: '3400:28,6500:100', presetNames: 'A,B' });
  type(dom, 0, 'third', '');
  assert.equal(editor.save(), true);
  assert.equal(sent.at(-1).presets, '3400,6500:100');
});

test('an added but abandoned row is not a preset', () => {
  const { editor, sent } = mount();
  editor.render({ presets: '3400:28', presetNames: 'A' });
  editor.addRow();
  assert.equal(editor.save(), true);
  assert.equal(sent.at(-1).presets, '3400:28');
});

test('deleting a row renumbers the rest and saves immediately', () => {
  const { editor, dom, sent } = mount();
  editor.render({ presets: '3400:100,4500:100,5600:100', presetNames: 'A,B,C' });
  const tr = dom.registry.get('preset-rows').querySelectorAll('tr')[1];
  // The row carries Save then Delete, so the second button removes the row.
  const buttons = tr.querySelectorAll('button');
  buttons[1].click();
  assert.equal(sent.at(-1).presets, '3400:100,5600:100');
  assert.equal(sent.at(-1).presetNames, 'A,C');
  assert.equal(rowInputs(dom, 1)[1].value, '5600');
  assert.equal(
    dom.registry.get('preset-rows').querySelectorAll('tr')[0].querySelector('td').textContent,
    '1',
    'the numbering is closed up'
  );
});

test('every row can still be deleted after one in the middle was', () => {
  // The reported failure: with two presets, the last one deleted and the one before it
  // then refused, and the only way out was to open another key and come back. The delete
  // button held the row's position from the moment it was built, so once a row was
  // removed every row below it pointed one place too far - at nothing at all.
  const { editor, dom, sent } = mount();
  editor.render({ presets: '3400:100,4500:100,5600:100', presetNames: 'A,B,C' });

  // Take out the middle one.
  dom.registry.get('preset-rows').querySelectorAll('tr')[1].querySelectorAll('button')[1].click();
  assert.equal(sent.at(-1).presets, '3400:100,5600:100');

  // The rows below it moved up, and their buttons have to follow.
  const remaining = dom.registry.get('preset-rows').querySelectorAll('tr');
  assert.equal(remaining.length, 2);
  remaining[1].querySelectorAll('button')[1].click();
  assert.equal(sent.at(-1).presets, '3400:100', 'the last row went too, on the same panel');

  remaining[0].querySelectorAll('button')[1].click();
  assert.equal(dom.registry.get('preset-rows').querySelectorAll('tr').length, 1, 'and the last one leaves the blank row');
});

test('deleting down to nothing leaves one empty row rather than an empty table', () => {
  const { editor, dom } = mount();
  editor.render({ presets: '3400:100,4500:100', presetNames: 'A,B' });
  const table = dom.registry.get('preset-rows');
  table.querySelectorAll('tr')[0].querySelectorAll('button')[1].click();
  table.querySelectorAll('tr')[0].querySelectorAll('button')[1].click();
  assert.equal(table.querySelectorAll('tr').length, 1, 'there is always somewhere to type');
});

test('adding twice leaves a single empty row to type into', () => {
  const { editor, dom } = mount();
  editor.render({ presets: '3400:28', presetNames: 'A' });
  editor.addRow();
  editor.addRow();
  assert.equal(dom.registry.get('preset-rows').querySelectorAll('tr').length, 2);
});

test('a row with a name but no value is refused until it is finished', () => {
  const { editor, dom, sent } = mount();
  editor.render({ presets: '3400:28', presetNames: 'A' });
  editor.addRow();
  type(dom, 1, 'name', 'Half typed');
  assert.equal(editor.save(), false);
  assert.equal(sent.length, 0, 'a half typed row is not written');
  assert.match(dom.registry.get('preset-status').textContent, /Preset 2/);

  type(dom, 1, 'value', '4500');
  type(dom, 1, 'third', '16');
  assert.equal(editor.save(), true);
  assert.equal(sent.at(-1).presets, '3400:28,4500:16');
});

test('the echo of a save does not rebuild the rows under the cursor', () => {
  // The host answers a save with the settings it just stored. Rebuilding on that echo
  // would throw away the caret of whoever is typing the next row.
  const { editor, dom } = mount();
  editor.render({ presets: '3400:28', presetNames: 'A' });
  editor.addRow();
  type(dom, 1, 'name', 'Sunset');
  type(dom, 1, 'value', '4500');
  type(dom, 1, 'third', '16');
  const before = dom.registry.get('preset-rows').querySelectorAll('tr')[1].querySelector('[data-field="name"]');

  assert.equal(editor.save(), true);
  editor.render({ presets: '3400:28,4500:16', presetNames: 'A,Sunset' });

  const after = dom.registry.get('preset-rows').querySelectorAll('tr')[1].querySelector('[data-field="name"]');
  assert.equal(after, before, 'the very same input node is still in the table');
  assert.equal(after.value, 'Sunset');
});

test('settings arriving from elsewhere do rebuild the rows', () => {
  const { editor, dom } = mount();
  editor.render({ presets: '3400:28', presetNames: 'A' });
  editor.render({ presets: '5600:70', presetNames: 'Elsewhere' });
  assert.equal(rowInputs(dom, 0)[1].value, '5600');
});

test('an echo about something else leaves a half typed row alone', () => {
  // Changing the device, the step or the bounds saves automatically, and the host answers
  // with the settings it stored. That answer describes the presets, which have not moved,
  // so rebuilding the rows would silently discard whatever was being typed - the exact
  // opposite of what an explicit Save button is for.
  const { editor, dom } = mount();
  editor.render({ presets: '3400:28', presetNames: 'A' });
  editor.addRow();
  type(dom, 1, 'name', 'Sunset');
  type(dom, 1, 'value', '4500');
  const before = dom.registry.get('preset-rows').querySelectorAll('tr')[1];

  editor.render({ presets: '3400:28', presetNames: 'A', device: 'lamp-2', step: '10' });

  const after = dom.registry.get('preset-rows').querySelectorAll('tr')[1];
  assert.equal(after, before, 'the row under the cursor is the same node');
  assert.equal(after.querySelector('[data-field="name"]').value, 'Sunset', 'and still holds what was typed');
});

test('an echo that really changed the presets does rebuild the rows', () => {
  // The counterpart, so the rule above cannot be met by simply never rebuilding: when the
  // stored list has moved, the rows are stale and have to follow.
  const { editor, dom } = mount();
  editor.render({ presets: '3400:28', presetNames: 'A' });
  editor.render({ presets: '3400:28,5600:70', presetNames: 'A,Daylight', device: 'lamp-2' });
  assert.equal(dom.registry.get('preset-rows').querySelectorAll('tr').length, 2, 'the added preset is shown');
  assert.equal(rowInputs(dom, 1)[1].value, '5600');
});

test('the per-row inputs are never persisted as settings of their own', () => {
  const { editor, sent } = mount();
  editor.render({ presets: '3400:28', presetNames: 'A' });
  editor.save();
  assert.deepEqual(Object.keys(sent.at(-1)).filter((k) => /^p\d+_/.test(k)), []);
  assert.equal(sent.at(-1).device, 'abc', 'the other settings of the panel survive');
});

test('a value that is not a number at all is refused too', () => {
  const { editor, dom, sent } = mount();
  editor.render({ presets: '3400:28', presetNames: 'A' });
  type(dom, 0, 'value', 'warm');
  assert.equal(editor.save(), false);
  assert.equal(sent.length, 0);
});

test('a single value list has no name column and stores no names', () => {
  // Brightness and saturation presets are a plain column of numbers. Showing a name
  // column would leave nothing to show, and storing names nobody displays would be a
  // second copy of the list free to drift.
  const { editor, dom, sent } = mount(VALUE_ONLY);
  editor.render({ presets: '25,50,100', presetNames: 'ignored,ignored,ignored' });
  assert.deepEqual(rowInputs(dom, 0), [{ field: 'value', value: '25' }]);

  type(dom, 1, 'value', '75');
  assert.equal(editor.save(), true);
  assert.equal(sent.at(-1).presets, '25,75,100');
  assert.equal('presetNames' in sent.at(-1), false, 'no names are written');
});

test('a single value list refuses a value out of range', () => {
  const { editor, dom, sent } = mount(VALUE_ONLY);
  editor.render({ presets: '25,50' });
  type(dom, 0, 'value', '150');
  assert.equal(editor.save(), false);
  assert.equal(sent.length, 0);
  assert.match(dom.registry.get('preset-status').textContent, /between 1 and 100/);
});

test('a single value list round trips what the service reads', () => {
  // The panel writes a bare list and the service parses bare numbers, so the two must
  // agree: an extra colon here would be a preset the service silently drops.
  const { editor, dom, sent } = mount(VALUE_ONLY);
  editor.render({ presets: '1,50' });
  editor.addRow();
  type(dom, 2, 'value', '100');
  assert.equal(editor.save(), true);
  assert.equal(sent.at(-1).presets, '1,50,100');
  assert.deepEqual(hue.parseHuePresets(sent.at(-1).presets), [
    { hue: 1, saturation: null },
    { hue: 50, saturation: null },
    { hue: 100, saturation: null },
  ]);
});

test('adding to a table that is only a blank row does not pile blanks up', () => {
  // One empty row is enough to type into; a second press reuses it rather than leaving
  // a row the user has to notice and delete.
  const { editor, dom } = mount(VALUE_ONLY);
  editor.render({ presets: '' });
  editor.addRow();
  editor.addRow();
  assert.equal(dom.registry.get('preset-rows').querySelectorAll('tr').length, 1);
});

test('the row actions are icon buttons that still say what they do', () => {
  // The label moved to `title` when the text came off the button, so without it the
  // two icons would be indistinguishable to anyone who cannot hover.
  const { editor, dom } = mount();
  editor.render({ presets: '3400:28', presetNames: 'A' });
  const buttons = dom.registry.get('preset-rows').querySelectorAll('tr')[0].querySelectorAll('button');
  assert.equal(buttons.length, 2);
  assert.deepEqual(buttons.map((b) => b.getAttribute('aria-label')), [
    'Save this preset',
    'Delete this preset',
  ]);
  assert.equal(buttons[0].textContent, '', 'no text inside the button');
  assert.equal(
    buttons[0].children[0].tagName,
    'SVG',
    'the icon is inline SVG so the panel loads no extra file'
  );
  assert.ok(buttons[0].children[0].children.length > 0, 'the icon has paths to draw');
});
