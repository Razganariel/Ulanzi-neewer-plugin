/**
 * The stepper panels and the actions behind them.
 *
 * A panel offers a fixed list of steps, and `Utils.setFormValue` skips a setting the
 * stored values do not carry. So an untouched panel shows whichever option happens to be
 * first in the HTML, while the action applies its own default. The panel and the action
 * then disagree, and the first unrelated save writes the displayed value: the step
 * changes without the user ever picking one.
 *
 * Every stepper panel is checked against the action that serves it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every action whose inspector is a stepper, with the default it really applies. */
const steppers = {
  'brightness-up': 'brightness-up.js',
  'brightness-down': 'brightness-down.js',
  'saturation-up': 'saturation-up.js',
  'saturation-down': 'saturation-down.js',
  'hue-up': 'hue-up.js',
  'hue-down': 'hue-down.js',
  'cct-up': 'cct-up.js',
  'cct-down': 'cct-down.js',
};

/** The step the action uses when the settings say nothing. */
function actionDefault(file) {
  const source = fs.readFileSync(path.join(ROOT, 'plugin/service/actions', file), 'utf8');
  const found = source.match(/\bstep:\s*(\d+)/);
  assert.ok(found, `${file} declares no default step`);
  return found[1];
}

/** The step the panel shows before anything is stored, i.e. its first option. */
function panelFirstOption(action) {
  const html = fs.readFileSync(
    path.join(ROOT, 'plugin/property-inspector', action, 'inspector.html'),
    'utf8'
  );
  const block = html.match(/<select\b[^>]*\bname="step"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(block, `${action} has no step selector`);
  const options = [...block[1].matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(options.length, `${action} offers no step at all`);
  return options[0];
}

for (const [action, file] of Object.entries(steppers)) {
  test(`${action}: the panel shows the step the action applies`, () => {
    assert.equal(
      panelFirstOption(action),
      actionDefault(file),
      'an untouched panel must show the step a press will really take'
    );
  });

  test(`${action}: the step it shows is one of the steps it offers`, () => {
    // Guards the other half: the default has to be selectable, or reordering the options
    // would leave the panel advertising something the action cannot apply.
    const html = fs.readFileSync(
      path.join(ROOT, 'plugin/property-inspector', action, 'inspector.html'),
      'utf8'
    );
    const block = html.match(/<select\b[^>]*\bname="step"[^>]*>([\s\S]*?)<\/select>/);
    const offered = [...block[1].matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(
      offered.includes(actionDefault(file)),
      `the default ${actionDefault(file)} is not among [${offered.join(',')}]`
    );
  });
}
