// Pure helpers for the static file server — no I/O, unit-tested in test-static.ts.
// resolveStatic is the path-traversal security boundary: keep changes covered by tests.

import { extname, resolve, sep } from 'node:path';

export const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Map a request path to a file inside staticDir, or null if it escapes the root. */
export function resolveStatic(staticDir: string, pathname: string): string | null {
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null; // malformed percent-encoding
  }
  if (p.endsWith('/')) p += 'index.html';
  else if (!extname(p)) p += '/index.html'; // Astro emits /route/index.html
  const full = resolve(staticDir, `.${p}`);
  if (full !== staticDir && !full.startsWith(staticDir + sep)) return null; // path traversal
  return full;
}

/**
 * Cache policy: only Astro's fingerprinted /_astro/* assets are truly immutable. Stable URLs
 * (HTML, /tts/model.onnx, favicon, manifest) must revalidate — an ETag turns that into a cheap
 * 304 instead of a re-download.
 */
export function cacheControl(pathname: string): string {
  return pathname.startsWith('/_astro/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

/** Weak ETag from file mtime + size — enough to make no-cache revalidation cheap. */
export function weakEtag(mtimeMs: number, size: number): string {
  return `W/"${mtimeMs.toString(16)}-${size.toString(16)}"`;
}
