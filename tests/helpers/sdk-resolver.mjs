/**
 * Makes the SDK importable from the service, which is otherwise impossible in a test.
 *
 * Two things stand between `plugin/service/app.js` and a test run:
 *
 *  - it imports `../ulanzi-api/index.js`, a path that only exists in a built plugin; the
 *    sources live in `sdk/`, which is fetched by `npm run sdk` and is not part of the
 *    repository;
 *  - the SDK imports `ws`, a native dependency that is not installed here.
 *
 * Both are redirected: the SDK to the copy on disk, and `ws` to a recorder. Nothing
 * opens a socket, so importing the service costs no network and no install.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SDK_ENTRY = pathToFileURL(path.join(HERE, '..', '..', 'sdk', 'ulanzi-api', 'index.js')).href;
const FAKE_WS = pathToFileURL(path.join(HERE, 'fake-ws.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  if (/ulanzi-api[\\/]index\.js$/.test(specifier)) {
    return { url: SDK_ENTRY, shortCircuit: true };
  }
  if (specifier === 'ws') {
    return { url: FAKE_WS, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
