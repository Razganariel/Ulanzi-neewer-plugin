/**
 * Every panel that offers a step, against the action that applies it.
 *
 * `Utils.setFormValue` skips a setting the stored values do not carry, so an untouched
 * panel shows whichever option happens to be first, while the action applies its own
 * default. The panel and the action then disagree, and the first unrelated save writes
 * the displayed value: the step changes without the user ever picking one.
 *
 * This file originally covered only the eight button panels. All four dial panels were
 * wrong and nothing noticed - which is the whole reason the check exists.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The eight one-step buttons and the four dials, with the action that serves each. */
const panels = {
  'brightness-up': 'brightness-up.js',
  'brightness-down': 'brightness-down.js',
  'saturation-up': 'saturation-up.js',
  'saturation-down': 'saturation-down.js',
  'hue-up': 'hue-up.js',
  'hue-down': 'hue-down.js',
  'cct-up': 'cct-up.js',
  'cct-down': 'cct-down.js',
  brightness: 'brightness.js',
  hue: 'hue.js',
  saturation: 'saturation.js',
  cct: 'cct.js',
};

/** The panels that offer a free number instead of a list, and so cannot drift the same way. */
const freeNumber = new Set(['brightness']);

const html = (panel) =>
  fs.readFileSync(path.join(ROOT, 'plugin/property-inspector', panel, 'inspector.html'), 'utf8');

/** The step the action uses when the settings say nothing. */
function actionDefault(file) {
  const source = fs.readFileSync(path.join(ROOT, 'plugin/service/actions', file), 'utf8');
  const found = source.match(/\bstep:\s*(\d+)/);
  assert.ok(found, `${file} declares no default step`);
  return found[1];
}

/** The steps the action will actually apply, as opposed to merely defaulting to. */
function allowedSteps(file) {
  const source = fs.readFileSync(path.join(ROOT, 'plugin/service/actions', file), 'utf8');
  const block = source.match(/dialStep\([^[]*\[([^\]]+)\]/);
  if (!block) return null;
  return block[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The options the panel offers, or null when it takes a free number. */
function panelOptions(panel) {
  const block = html(panel).match(/<select\b[^>]*\bname="step"[^>]*>([\s\S]*?)<\/select>/);
  if (!block) return null;
  return [...block[1].matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
}

for (const [panel, file] of Object.entries(panels)) {
  const offered = panelOptions(panel);

  if (freeNumber.has(panel)) {
    test(`${panel}: the free step field can express the default`, () => {
      // A number field accepts anything, so the risk here is the opposite one: a value the
      // user types that the action then throws away.
      const input = html(panel).match(/<input[^>]*\bname="step"[^>]*>/);
      assert.ok(input, `${panel} has neither a step select nor a step input`);
      const min = Number((input[0].match(/\bmin="(\d+)"/) || [])[1] ?? 0);
      const max = Number((input[0].match(/\bmax="(\d+)"/) || [])[1] ?? Infinity);
      const wanted = Number(actionDefault(file));
      assert.ok(wanted >= min && wanted <= max, `the default ${wanted} is outside [${min}, ${max}]`);
    });
    continue;
  }

  test(`${panel}: the panel shows the step the action applies`, () => {
    assert.ok(offered?.length, `${panel} offers no step at all`);
    assert.equal(
      offered[0],
      actionDefault(file),
      'an untouched panel must show the step a press will really take'
    );
  });

  test(`${panel}: the default is one of the steps it offers`, () => {
    // Guards the other half: the default has to be selectable, or reordering the options
    // would leave the panel advertising something the action cannot apply.
    assert.ok(offered.includes(actionDefault(file)), `the default is not among [${offered.join(',')}]`);
  });

  test(`${panel}: every step it offers is one the action applies`, () => {
    // The list and the action have to be the same list. An option the action silently
    // replaces by its default is a control that appears to work and does nothing.
    const allowed = allowedSteps(file);
    if (!allowed) return;
    const refused = offered.filter((value) => !allowed.includes(value));
    assert.deepEqual(refused, [], `offered but refused by the action: ${refused.join(', ')}`);
  });
}

test('the temperature step is a multiple of what the wire can carry', () => {
  // The protocol sends the temperature as one byte of 100 K, so a step that is not a
  // multiple of 100 cannot land where the dial said: 2500 + 250 = 2750 is not a value the
  // frame can express, and the lamp rounds it. The default was 250 until now.
  const allowed = allowedSteps('cct.js');
  assert.ok(allowed?.length, 'cct.js restricts its step to a list');
  const offGrid = allowed.filter((step) => Number(step) % 100 !== 0);
  assert.deepEqual(offGrid, [], `steps the wire cannot express: ${offGrid.join(', ')}`);
  assert.equal(Number(actionDefault('cct.js')) % 100, 0, 'and the default has to be one of them');

  // The panel offers nothing else either.
  const refused = panelOptions('cct').filter((value) => Number(value) % 100 !== 0);
  assert.deepEqual(refused, [], `the panel offers steps the wire cannot carry: ${refused.join(', ')}`);
});

test('the button steps are on the same grid', () => {
  // The up and down buttons quantise to 100 K already; this keeps it that way.
  for (const panel of ['cct-up', 'cct-down']) {
    assert.equal(Number(actionDefault(`${panel}.js`)) % 100, 0, `${panel} steps off the grid`);
  }
});
