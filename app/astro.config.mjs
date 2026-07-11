// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

// Static site. Content is read from the repo-root markdown/CSV (single source of truth).
// Markdown renders through marked (index.astro) — link rewriting lives in lessons.ts cleanLinks.
export default defineConfig({
  site: 'http://localhost:4321',

  vite: {
    // Allow reading the source-of-truth CSV/markdown from the repo root (above app/).
    // Dev runs on 4322 (HMR) and proxies /api to the app server (server/main.ts) on :4321,
    // which in `npm run serve` mode also serves the built dist.
    server: {
      port: 4322,
      fs: { allow: ['..'] },
      allowedHosts: ['localhost', 'xerox-handclap-baggie.ngrok-free.dev'],
      proxy: { '/api': 'http://localhost:4321' },
    },
  },

  integrations: [react()],
});