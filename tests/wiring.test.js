/**
 * Wiring mistakes that syntax checking cannot see.
 *
 * `node --check` only parses. A name that is used but never imported parses perfectly and
 * throws a ReferenceError the first time it runs. In the main service that error lands in
 * the `uncaughtException` handler, which logs it and lets the process carry on, so the
 * plugin still works and the broken line is one log entry nobody reads.
 *
 * That is not hypothetical: `installShutdownHandlers(registry)` ran at module level with
 * no matching import, which silently left the service with no shutdown handling at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function serviceFiles(dir = path.join(ROOT, 'plugin/service'), out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) serviceFiles(p, out);
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Everything the file brings into scope: imports, plus anything it declares. */
function boundNames(text) {
  const bound = new Set();

  for (const m of text.matchAll(/import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\})?\s*from/g)) {
    if (m[1]) bound.add(m[1]);
    for (const part of (m[2] || '').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) bound.add(name);
    }
  }
  for (const m of text.matchAll(/import\s+([\w$]+)\s+from/g)) bound.add(m[1]);

  for (const m of text.matchAll(/(?:function|class)\s+([\w$]+)/g)) bound.add(m[1]);
  for (const m of text.matchAll(/(?:const|let|var)\s+([\w$]+)/g)) bound.add(m[1]);
  // destructured bindings, however they are written
  for (const m of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/[:=]/)[0].trim();
      if (/^[\w$]+$/.test(name)) bound.add(name);
    }
  }
  return bound;
}

const GLOBALS = new Set(['process', 'console', 'globalThis', 'structuredClone', 'queueMicrotask']);

/** Words that look like a call at the start of a line but are not one. */
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'new',
  'function', 'do', 'else', 'with', 'delete', 'void', 'yield', 'throw', 'case',
]);

test('every top-level call in the service resolves to something in scope', () => {
  // Only column-zero calls: they are the wiring, they run on import, and they are the
  // ones whose failure is swallowed. `foo.bar()` and indented bodies are out of scope
  // here on purpose, to keep this free of false alarms.
  const files = serviceFiles();
  assert.ok(files.length > 20, 'the service was found');

  const problems = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const bound = boundNames(text);
    text.split('\n').forEach((line, i) => {
      const m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(line);
      if (!m) return;
      const name = m[1];
      if (bound.has(name) || GLOBALS.has(name) || KEYWORDS.has(name)) return;
      problems.push(`${path.relative(ROOT, file)}:${i + 1} calls "${name}", which is never imported or declared`);
    });
  }
  assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`);
});

test('the main service imports everything it calls at module level', () => {
  // Named on its own because this file is the one that swallows its own errors: the
  // test above proves the name is in scope, this one names the function that was lost.
  const text = fs.readFileSync(path.join(ROOT, 'plugin/service/app.js'), 'utf8');
  const called = [...text.matchAll(/^([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
  assert.ok(called.includes('installShutdownHandlers'), 'the service still installs its shutdown handlers');
});
