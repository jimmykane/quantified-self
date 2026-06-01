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
      hub: 'features',
      aiInsights: 'features/ai-insights',
      workoutFileComparison: 'features/workout-file-comparison',
      fitGpxTcxFileAnalyzer: 'features/fit-gpx-tcx-file-analyzer',
      sportsWatchBenchmark: 'features/sports-watch-benchmark',
    });
    expect(PUBLIC_GUIDE_PATHS).toEqual({
      hub: 'guides',
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
    expect(PUBLIC_SEO_PAGES.featuresHub.h1).toBe('Features for endurance training data');
    expect(PUBLIC_SEO_PAGES.featuresHub.intro).toContain('compare recordings');
    expect(PUBLIC_SEO_PAGES.featuresHub.description).toContain('sports watch benchmark reports');

    expect(PUBLIC_SEO_PAGES.aiInsights.h1).toBe('AI insights for endurance training data');
    expect(PUBLIC_SEO_PAGES.aiInsights.description).toContain('chart-backed AI insights');
    expect(PUBLIC_SEO_PAGES.aiInsights.description).toContain('Free accounts include');

    expect(PUBLIC_SEO_PAGES.workoutFileComparison.h1).toBe('Compare FIT, TCX, GPX, JSON, and SML workout files');
    expect(PUBLIC_SEO_PAGES.workoutFileComparison.intro).toContain('Manual uploads and benchmark comparisons are available on the free plan');
    expect(PUBLIC_SEO_PAGES.workoutFileComparison.intro).toContain('custom exports');

    expect(PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer.h1).toBe('Analyze FIT, GPX, and TCX workout files');
    expect(PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer.description).toContain('FIT file analyzer');
    expect(PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer.chips).toContain('GPX file analyzer');
    expect(PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer.intro).toContain('maps, charts, stats, exports');
    expect(PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer.faqItems.some(item => item.question === 'Can I analyze FIT files?')).toBe(true);

    expect(PUBLIC_SEO_PAGES.sportsWatchBenchmark.h1).toBe('Sports watch benchmark reports for reviewers and device tests');
    expect(PUBLIC_SEO_PAGES.sportsWatchBenchmark.intro).toContain('YouTube videos');
    expect(PUBLIC_SEO_PAGES.sportsWatchBenchmark.intro).toContain('firmware QA');

    expect(PUBLIC_SEO_PAGES.guidesHub.h1).toBe('Training data sync guides');
    expect(PUBLIC_SEO_PAGES.guidesHub.description).toContain('Garmin -> Suunto sync');
    expect(PUBLIC_SEO_PAGES.guidesHub.intro).toContain('centralized Garmin, Suunto, and COROS workout archive');

    expect(PUBLIC_SEO_PAGES.syncGarminToSuunto.h1).toBe('How to sync Garmin data to Suunto automatically');
    expect(PUBLIC_SEO_PAGES.syncGarminToSuunto.howToSteps).toHaveLength(4);

    expect(PUBLIC_SEO_PAGES.centralizeWorkoutData.h1).toBe('Centralize Garmin, Suunto, and COROS workout data');
    expect(PUBLIC_SEO_PAGES.centralizeWorkoutData.intro).not.toContain('centralize Garmin Suunto and COROS workout data');
  });

  it('links hub pages to the focused feature and guide pages they introduce', () => {
    const featureHubLinks = [
      ...PUBLIC_SEO_PAGES.featuresHub.actions,
      ...PUBLIC_SEO_PAGES.featuresHub.closingActions,
    ].map(action => action.routerLink);
    const guideHubLinks = [
      ...PUBLIC_SEO_PAGES.guidesHub.actions,
      ...PUBLIC_SEO_PAGES.guidesHub.closingActions,
    ].map(action => action.routerLink);

    expect(featureHubLinks).toContain('/features/ai-insights');
    expect(featureHubLinks).toContain('/features/workout-data-comparison');
    expect(featureHubLinks).toContain('/features/workout-file-comparison');
    expect(featureHubLinks).toContain('/features/fit-gpx-tcx-file-analyzer');
    expect(featureHubLinks).toContain('/features/sports-watch-benchmark');
    expect(featureHubLinks).toContain('/integrations');
    expect(featureHubLinks).toContain('/guides');

    expect(guideHubLinks).toContain('/guides/sync-garmin-to-suunto');
    expect(guideHubLinks).toContain('/guides/sync-coros-to-suunto');
    expect(guideHubLinks).toContain('/guides/centralize-garmin-suunto-coros-workout-data');
    expect(guideHubLinks).toContain('/features');
    expect(guideHubLinks).toContain('/integrations');
  });

  it('keeps HowTo JSON-LD step text aligned with visible guide steps', () => {
    const jsonLd = PUBLIC_SEO_ROUTE_DATA.syncGarminToSuunto.jsonLd;
    const mainEntity = jsonLd['mainEntity'] as Record<string, unknown>[];
    const howTo = mainEntity.find(entity => entity['@type'] === 'HowTo');
    const steps = howTo?.['step'] as Record<string, unknown>[];

    expect(steps).toHaveLength(PUBLIC_SEO_PAGES.syncGarminToSuunto.howToSteps?.length);

    for (const [index, step] of steps.entries()) {
      const expectedStep = PUBLIC_SEO_PAGES.syncGarminToSuunto.howToSteps?.[index];

      expect(step).toMatchObject({
        '@type': 'HowToStep',
        position: index + 1,
        name: expectedStep,
        text: expectedStep,
      });
    }
  });
});
