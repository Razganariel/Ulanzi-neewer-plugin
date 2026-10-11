/**
 * The manifest against the code and the files behind it.
 *
 * The manifest is the only description the deck has of this plugin, and a wrong entry in
 * it does not fail a build: it fails on the deck, where the user is looking at a key that
 * does nothing. So the things that can silently disagree are checked here instead.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registry } from '../plugin/service/actions/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin/manifest.json'), 'utf8'));
const actions = manifest.Actions || [];

test('the plugin icon the manifest names exists', () => {
  // `build.mjs` checks every action's state image but never the plugin's own icon, so a
  // wrong path here ships as a blank tile with a green build.
  assert.ok(manifest.Icon, 'the manifest declares no icon at all');
  assert.ok(
    fs.existsSync(path.join(ROOT, 'plugin', manifest.Icon)),
    `${manifest.Icon} is declared but not on disk`
  );
});

test('every file the manifest names exists', () => {
  const missing = [];
  for (const action of actions) {
    for (const rel of [action.Icon, action.PropertyInspectorPath, ...(action.States || []).map((s) => s.Image)]) {
      if (rel && !fs.existsSync(path.join(ROOT, 'plugin', rel))) missing.push(`${action.UUID}: ${rel}`);
    }
  }
  assert.deepEqual(missing, [], `\n${missing.join('\n')}\n`);
});

test('the manifest and the action registry describe the same sixteen actions', () => {
  const declared = actions.map((a) => a.UUID).sort();
  const registered = [...registry.keys()].sort();
  assert.deepEqual(registered, declared, 'an action in one and not the other is invisible or unreachable');
  assert.equal(new Set(registered).size, registered.length, 'no uuid is claimed twice');
});

test('no action is missing a field the deck needs', () => {
  const problems = [];
  for (const action of actions) {
    if (!action.UUID) problems.push('an action has no UUID');
    if (!action.Name) problems.push(`${action.UUID}: no Name`);
    // A controller list is what puts the action on a key or a dial. Empty means the
    // action is listed and can never be placed.
    if (!action.Controllers?.length) problems.push(`${action.UUID}: no Controllers, it can never be placed`);
    if (new Set((action.States || []).map((s) => s.Name)).size !== (action.States || []).length) {
      problems.push(`${action.UUID}: two states share a name`);
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`);
});

test('every inspector page is reachable from the manifest', () => {
  // A panel directory holding a second page is a trap: the stale one is a full, valid
  // looking copy that nothing points at, and pointing the manifest at it by accident
  // downgrades the panel with no error anywhere.
  const declared = new Set(actions.map((a) => a.PropertyInspectorPath).filter(Boolean));
  const root = path.join(ROOT, 'plugin/property-inspector');
  const orphans = [];
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const page = `property-inspector/${dir.name}/inspector.html`;
    if (fs.existsSync(path.join(root, dir.name, 'inspector.html')) && !declared.has(page)) {
      orphans.push(page);
    }
    for (const file of fs.readdirSync(path.join(root, dir.name))) {
      if (file.endsWith('.html') && file !== 'inspector.html') {
        orphans.push(`property-inspector/${dir.name}/${file} (a panel directory should hold one page)`);
      }
    }
  }
  assert.deepEqual(orphans, [], `\n${orphans.join('\n')}\n`);
});

test('each inspector page carries the uuid of the action it serves', () => {
  // The host routes a panel by this attribute. A page that disagrees is a panel that
  // never receives anything.
  const wrong = [];
  for (const action of actions) {
    if (!action.PropertyInspectorPath) continue;
    const html = fs.readFileSync(path.join(ROOT, 'plugin', action.PropertyInspectorPath), 'utf8');
    const match = html.match(/data-actionid="([^"]*)"/);
    if (!match) wrong.push(`${action.UUID}: no data-actionid`);
    else if (match[1] !== action.UUID) wrong.push(`${action.UUID}: page says ${match[1]}`);
  }
  assert.deepEqual(wrong, [], `\n${wrong.join('\n')}\n`);
});

test('every shipped image is either the plugin icon or a state someone uses', () => {
  const used = new Set([manifest.Icon]);
  for (const action of actions) {
    if (action.Icon) used.add(action.Icon);
    for (const state of action.States || []) if (state.Image) used.add(state.Image);
  }
  const dir = path.join(ROOT, 'plugin/images');
  const orphans = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.svg') && !used.has(`images/${f}`));
  assert.deepEqual(orphans, [], `shipped but referenced by nothing: ${orphans.join(', ')}`);
});
