import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ACTIVITY_MAP_PRERENDER_METADATA, RELEASES_PRERENDER_METADATA, TOOLS_COMPARE_PRERENDER_METADATA, TRAINING_PLANS_PRERENDER_METADATA } from '../../../tools/public-prerender-metadata.mjs';
import { TRAINING_PLANS_SEO_CONTENT } from '../components/public-seo/training-plans-page.content';
import { PUBLIC_SEO_PAGES } from '../components/public-seo/public-seo-pages.content';

describe('public prerender metadata', () => {
  it.each(['title', 'description', 'h1', 'accessNote', 'freeOfferDescription'] as const)(
    'keeps the My Tracks build verifier %s aligned with public route content', key => {
      expect(ACTIVITY_MAP_PRERENDER_METADATA[key]).toBe(PUBLIC_SEO_PAGES.activityMap[key]);
    },
  );

  it('keeps the release notes build verifier aligned with its route and page heading', () => {
    const source = readFileSync(new URL('../app.routing.module.ts', import.meta.url), 'utf8');
    const route = source.split("path: 'releases',")[1]?.split("path: 'payment/cancel',")[0];
    const page = readFileSync(new URL('../components/whats-new/whats-new-page.component.ts', import.meta.url), 'utf8');
    expect(route).toContain(`title: '${RELEASES_PRERENDER_METADATA.title}'`);
    expect(route).toContain(`description: '${RELEASES_PRERENDER_METADATA.description}'`);
    expect(page.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(RELEASES_PRERENDER_METADATA.h1);
  });

  it('keeps the comparison build verifier aligned with route metadata and guest copy', () => {
    const routeSource = readFileSync(new URL('../app.routing.module.ts', import.meta.url), 'utf8');
    const compareRoute = routeSource.split("path: 'tools/compare',")[1]?.split("path: 'tools/compare/saved',")[0];
    const template = readFileSync(
      new URL('../components/tools/tools-compare-page.component.html', import.meta.url),
      'utf8',
    );

    expect(compareRoute).toContain(`title: '${TOOLS_COMPARE_PRERENDER_METADATA.title}'`);
    expect(compareRoute).toContain(`description: '${TOOLS_COMPARE_PRERENDER_METADATA.description}'`);
    expect(template.match(/<h1[^>]*id="tools-compare-title"[^>]*>([^<]*)<\/h1>/)?.[1])
      .toBe(TOOLS_COMPARE_PRERENDER_METADATA.h1);
    for (const copy of TOOLS_COMPARE_PRERENDER_METADATA.visibleCopy) {
      expect(template.replace(/\s+/g, ' ')).toContain(copy);
    }
  });

  it.each(['title', 'description', 'h1'] as const)(
    'keeps the build verifier %s aligned with the Training Plans route content',
    key => {
      expect(TRAINING_PLANS_PRERENDER_METADATA[key]).toBe(TRAINING_PLANS_SEO_CONTENT[key]);
    },
  );
});
