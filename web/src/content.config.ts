import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Lesson source of truth lives in the app: src/content/steps/step-NN.md.
// The root phrases.md is still read directly from the repo root.
const steps = defineCollection({
  loader: glob({ pattern: 'step-*.md', base: './src/content/steps' }),
});

const docs = defineCollection({
  loader: glob({ pattern: 'phrases.md', base: '..' }),
});

export const collections = { steps, docs };
