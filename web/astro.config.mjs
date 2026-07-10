// @ts-check
import { defineConfig } from 'astro/config';
import remarkRewriteLinks from './src/lib/remark-rewrite-links.mjs';

import react from '@astrojs/react';

// Static site. Content is read from the repo-root markdown/CSV (single source of truth).
export default defineConfig({
  site: 'http://localhost:4321',

  markdown: {
    remarkPlugins: [remarkRewriteLinks],
  },

  vite: {
    // Allow reading the source-of-truth CSV/markdown from the repo root (above web/).
    // /api proxies to the ASR backend (server/, uvicorn on :8000) during dev.
    server: {
      fs: { allow: ['..'] },
      allowedHosts: ['localhost', 'xerox-handclap-baggie.ngrok-free.dev'],
      proxy: { '/api': 'http://localhost:8000' },
    },
    // Don't prebundle onnxruntime-web: its wasm must stay next to the served module,
    // otherwise dev requests /node_modules/.vite/deps/*.wasm and 404s.
    optimizeDeps: { exclude: ['onnxruntime-web'] },
  },

  integrations: [react()],
});