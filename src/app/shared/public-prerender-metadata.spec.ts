import { describe, expect, it } from 'vitest';
import { TRAINING_PLANS_PRERENDER_METADATA } from '../../../tools/public-prerender-metadata.mjs';
import { TRAINING_PLANS_SEO_CONTENT } from '../components/public-seo/training-plans-page.content';

describe('public prerender metadata', () => {
  it.each(['title', 'description', 'h1'] as const)(
    'keeps the build verifier %s aligned with the Training Plans route content',
    key => {
      expect(TRAINING_PLANS_PRERENDER_METADATA[key]).toBe(TRAINING_PLANS_SEO_CONTENT[key]);
    },
  );
});
