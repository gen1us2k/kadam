import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Single source of truth: load the repo-root markdown directly. No content is duplicated
// into the app — editing weeks/*/README.md or the root docs updates the site.
const weeks = defineCollection({
  loader: glob({ pattern: 'week-*/README.md', base: '../weeks' }),
});

const docs = defineCollection({
  loader: glob({ pattern: '{grammar-cheatsheet,phrases}.md', base: '..' }),
});

export const collections = { weeks, docs };
