import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Lesson source of truth lives in the app: src/content/weeks/week-NN.md.
// The root phrases.md is still read directly from the repo root.
const weeks = defineCollection({
  loader: glob({ pattern: 'week-*.md', base: './src/content/weeks' }),
});

const docs = defineCollection({
  loader: glob({ pattern: 'phrases.md', base: '..' }),
});

export const collections = { weeks, docs };
