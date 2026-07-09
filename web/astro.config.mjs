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
    server: { fs: { allow: ['..'] } },
  },

  integrations: [react()],
});