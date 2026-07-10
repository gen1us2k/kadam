// Regression guard for the static-serving helpers (static.ts). resolveStatic is the
// path-traversal security boundary — every containment case here must keep passing.
// Run: `npm test` (Node >=23 runs .ts directly).

import { sep } from 'node:path';
import { CONTENT_TYPES, cacheControl, resolveStatic, weakEtag } from './static.ts';

const ROOT = `${sep}srv${sep}dist`; // platform-correct absolute root

let fail = 0;
const check = (name: string, cond: boolean, got?: unknown) => {
  if (!cond) {
    fail++;
    console.log('FAIL:', name, '| got', got);
  }
};

// --- containment (must resolve inside ROOT) ---
check('root -> index.html', resolveStatic(ROOT, '/') === `${ROOT}${sep}index.html`);
check('trailing slash -> index.html', resolveStatic(ROOT, '/poc-speech/') === `${ROOT}${sep}poc-speech${sep}index.html`);
check('extensionless -> dir index', resolveStatic(ROOT, '/poc-speech') === `${ROOT}${sep}poc-speech${sep}index.html`);
check('asset passthrough', resolveStatic(ROOT, '/tts/model.onnx') === `${ROOT}${sep}tts${sep}model.onnx`);
check('dot-segment inside stays inside', resolveStatic(ROOT, '/a/../b.js') === `${ROOT}${sep}b.js`);

// --- traversal / injection (must return null) ---
check('plain traversal', resolveStatic(ROOT, '/../etc/passwd') === null);
check('encoded traversal', resolveStatic(ROOT, '/%2e%2e/%2e%2e/etc/passwd') === null);
check('encoded slashes traversal', resolveStatic(ROOT, '/%2e%2e%2f%2e%2e%2fetc%2fpasswd') === null);
check('deep traversal', resolveStatic(ROOT, '/a/../../../../etc/passwd') === null);
check('malformed percent', resolveStatic(ROOT, '/%zz') === null);
// Sibling-prefix dir (/srv/dist-evil) must not pass the startsWith guard.
check('sibling prefix blocked', resolveStatic(ROOT, '/../dist-evil/x.js') === null);

// Double-encoding decodes ONCE -> literal "%2e%2e" filename, contained (not a traversal).
const doubleEnc = resolveStatic(ROOT, '/%252e%252e/x');
check('double-encoding stays contained', doubleEnc !== null && doubleEnc.startsWith(ROOT + sep), doubleEnc);

// --- cache policy ---
check('fingerprinted -> immutable', cacheControl('/_astro/app.Ck2f.js') === 'public, max-age=31536000, immutable');
check('html -> no-cache', cacheControl('/index.html') === 'no-cache');
check('model -> no-cache (revalidatable)', cacheControl('/tts/model.onnx') === 'no-cache');
check('favicon -> no-cache', cacheControl('/favicon.svg') === 'no-cache');

// --- etag ---
check('etag is weak + deterministic', weakEtag(1234567.89, 42) === weakEtag(1234567.89, 42) && weakEtag(1234567.89, 42).startsWith('W/"'));
check('etag differs on size', weakEtag(1234567.89, 42) !== weakEtag(1234567.89, 43));

// --- content types sanity ---
check('js type', CONTENT_TYPES['.js']?.startsWith('text/javascript') === true);
check('wasm type', CONTENT_TYPES['.wasm'] === 'application/wasm');

console.log(fail === 0 ? 'ALL STATIC TESTS PASSED' : `${fail} TEST(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
