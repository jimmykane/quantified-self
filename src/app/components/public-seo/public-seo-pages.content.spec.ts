import { describe, expect, it } from 'vitest';
import {
  PUBLIC_FEATURE_PATHS,
  PUBLIC_GUIDE_PATHS,
  PUBLIC_SEO_PAGES,
  PUBLIC_SEO_ROUTE_DATA,
} from './public-seo-pages.content';

describe('public-seo-pages.content', () => {
  it('defines distinct public feature and guide paths', () => {
    expect(PUBLIC_FEATURE_PATHS).toEqual({
      aiInsights: 'features/ai-insights',
      workoutFileComparison: 'features/workout-file-comparison',
      sportsWatchBenchmark: 'features/sports-watch-benchmark',
    });
    expect(PUBLIC_GUIDE_PATHS).toEqual({
      syncGarminToSuunto: 'guides/sync-garmin-to-suunto',
      syncCorosToSuunto: 'guides/sync-coros-to-suunto',
      centralizeWorkoutData: 'guides/centralize-garmin-suunto-coros-workout-data',
    });
  });

  it('keeps route metadata complete without meta-keywords', () => {
    for (const [key, page] of Object.entries(PUBLIC_SEO_PAGES)) {
      const routeData = PUBLIC_SEO_ROUTE_DATA[key as keyof typeof PUBLIC_SEO_ROUTE_DATA];

      expect(page.h1.trim().length).toBeGreaterThan(0);
      expect(page.description.trim().length).toBeGreaterThan(0);
      expect(page.sections.length).toBeGreaterThanOrEqual(2);
      expect(page.faqItems.length).toBeGreaterThanOrEqual(3);
      expect(page.actions.length).toBeGreaterThan(0);
      expect(routeData.title).toBe(page.title);
      expect(routeData.description).toBe(page.description);
      expect(routeData.publicSeoPage).toBe(page);
      expect(routeData).not.toHaveProperty('keywords');
      expect(routeData.jsonLd).toMatchObject({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: page.h1,
        url: `https://quantified-self.io/${page.path}`,
        inLanguage: 'en',
      });
    }
  });

  it('keeps the new pages focused on separate search intents', () => {
    expect(PUBLIC_SEO_PAGES.aiInsights.h1).toBe('AI insights for endurance training data');
    expect(PUBLIC_SEO_PAGES.aiInsights.description).toContain('chart-backed AI insights');
    expect(PUBLIC_SEO_PAGES.aiInsights.description).toContain('Free accounts include');

    expect(PUBLIC_SEO_PAGES.workoutFileComparison.h1).toBe('Compare FIT, TCX, GPX, JSON, and SML workout files');
    expect(PUBLIC_SEO_PAGES.workoutFileComparison.intro).toContain('Manual uploads and benchmark comparisons are available on the free plan');
    expect(PUBLIC_SEO_PAGES.workoutFileComparison.intro).toContain('custom exports');

    expect(PUBLIC_SEO_PAGES.sportsWatchBenchmark.h1).toBe('Sports watch benchmark reports for reviewers and device tests');
    expect(PUBLIC_SEO_PAGES.sportsWatchBenchmark.intro).toContain('YouTube videos');
    expect(PUBLIC_SEO_PAGES.sportsWatchBenchmark.intro).toContain('firmware QA');

    expect(PUBLIC_SEO_PAGES.syncGarminToSuunto.h1).toBe('How to sync Garmin data to Suunto automatically');
    expect(PUBLIC_SEO_PAGES.syncGarminToSuunto.howToSteps).toHaveLength(4);

    expect(PUBLIC_SEO_PAGES.centralizeWorkoutData.h1).toBe('Centralize Garmin, Suunto, and COROS workout data');
    expect(PUBLIC_SEO_PAGES.centralizeWorkoutData.intro).not.toContain('centralize Garmin Suunto and COROS workout data');
  });
});
