import { describe, expect, it } from 'vitest';
import { routes } from './app.routing.module';
import { authGuard } from './authentication/app.auth.guard';
import { aiInsightsGuard } from './authentication/ai-insights.guard';
import { onboardingGuard } from './authentication/onboarding.guard';
import { toolsCompareAuthResolver } from './resolvers/tools-compare-auth.resolver';
import { PUBLIC_FEATURE_PATHS, PUBLIC_GUIDE_PATHS } from './components/public-seo/public-seo-pages.content';

describe('AppRoutingModule routes', () => {
  it('should define a public help route with help metadata', () => {
    const helpRoute = routes.find(route => route.path === 'help');

    expect(helpRoute).toBeTruthy();
    expect(helpRoute?.canMatch).toBeUndefined();
    expect(helpRoute?.loadComponent).toBeTypeOf('function');
    expect(helpRoute?.data).toMatchObject({
      title: 'Help & Support',
      description: 'Get help with Garmin -> Suunto and COROS -> Suunto sync routes, Suunto -> Garmin course delivery, catch-up sync, AI Insights, account setup, uploads, billing, privacy, and troubleshooting in Quantified Self.',
      animation: 'Help',
      preload: true,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'Quantified Self Help & Support',
        url: 'https://quantified-self.io/help',
        inLanguage: 'en',
      },
    });
    const helpJsonLd = helpRoute?.data?.['jsonLd'] as Record<string, unknown> | undefined;
    const helpAbout = helpJsonLd?.['about'] as string[] | undefined;
    expect(helpAbout).toContain('Garmin -> Suunto sync');
    expect(helpAbout).toContain('COROS -> Suunto sync');
    expect(helpAbout).toContain('Suunto -> Garmin course delivery');
    expect(helpAbout).toContain('Catch-up sync');
  });

  it('should define a public pricing route with membership JSON-LD', () => {
    const pricingRoute = routes.find(route => route.path === 'pricing');
    const jsonLd = pricingRoute?.data?.['jsonLd'] as Record<string, unknown> | undefined;

    expect(pricingRoute).toBeTruthy();
    expect(pricingRoute?.loadComponent).toBeTypeOf('function');
    expect(pricingRoute?.data?.['title']).toBe('Membership');
    expect(pricingRoute?.data?.['description']).toContain('Support the development of Quantified Self');
    expect(pricingRoute?.data?.['keywords']).toBeUndefined();
    expect(jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Quantified Self Membership',
      url: 'https://quantified-self.io/pricing',
      inLanguage: 'en',
    });
  });

  it('should allow any authenticated onboarded user to access mytracks', () => {
    const myTracksRoute = routes.find(route => route.path === 'mytracks');

    expect(myTracksRoute).toBeTruthy();
    expect(myTracksRoute?.canMatch).toEqual([authGuard, onboardingGuard]);
    expect(myTracksRoute?.data?.['disableRouteAnimation']).toBe(true);
  });

  it('should keep the private routes library authenticated and noindexed', () => {
    const routesRoute = routes.find(route => route.path === 'routes');

    expect(routesRoute).toBeTruthy();
    expect(routesRoute?.canMatch).toEqual([authGuard, onboardingGuard]);
    expect(routesRoute?.data?.['robots']).toBe('noindex, follow');
  });

  it('should protect ai insights behind auth, onboarding, and pro access', () => {
    const aiInsightsRoute = routes.find(route => route.path === 'ai-insights');

    expect(aiInsightsRoute).toBeTruthy();
    expect(aiInsightsRoute?.canMatch).toEqual([authGuard, onboardingGuard, aiInsightsGuard]);
    expect(aiInsightsRoute?.loadComponent).toBeTypeOf('function');
    expect(aiInsightsRoute?.data).toMatchObject({
      title: 'AI Insights',
      preload: true,
      animation: 'AIInsights',
    });
  });

  it('should define a public integrations hub route with collection metadata', () => {
    const integrationsRoute = routes.find(route => route.path === 'integrations');

    expect(integrationsRoute).toBeTruthy();
    expect(integrationsRoute?.canMatch).toBeUndefined();
    expect(integrationsRoute?.loadComponent).toBeTypeOf('function');
    expect(integrationsRoute?.data).toMatchObject({
      title: 'Integrations',
      preload: true,
      animation: 'Integrations',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Quantified Self Integrations',
        url: 'https://quantified-self.io/integrations',
        inLanguage: 'en',
      },
    });
    expect(integrationsRoute?.data?.['description']).toContain('Garmin, Suunto, and COROS integrations');
  });

  it('should define public Garmin, Suunto, and COROS provider integration routes', () => {
    const expectedRoutes = [
      { path: 'integrations/garmin', provider: 'garmin', descriptionText: 'private training dashboard for Garmin data' },
      { path: 'integrations/suunto', provider: 'suunto', descriptionText: 'Sync Garmin and COROS activities to Suunto' },
      { path: 'integrations/coros', provider: 'coros', descriptionText: 'COROS -> Suunto sync' },
    ];

    for (const expectedRoute of expectedRoutes) {
      const route = routes.find(candidate => candidate.path === expectedRoute.path);
      const jsonLd = route?.data?.['jsonLd'] as Record<string, unknown> | undefined;

      expect(route).toBeTruthy();
      expect(route?.canMatch).toBeUndefined();
      expect(route?.loadComponent).toBeTypeOf('function');
      expect(route?.data?.['integrationProvider']).toBe(expectedRoute.provider);
      expect(route?.data?.['keywords']).toBeUndefined();
      expect(route?.data?.['description']).toContain(expectedRoute.descriptionText);
      expect(jsonLd?.['@type']).toBe('WebPage');
      expect(jsonLd?.['url']).toBe(`https://quantified-self.io/${expectedRoute.path}`);
    }

    const garminRoute = routes.find(candidate => candidate.path === 'integrations/garmin');
    expect(garminRoute?.data?.['title']).toBe('Private Garmin Training Dashboard');
  });

  it('should define public tools routes with compare workflow metadata', () => {
    const toolsRoute = routes.find(candidate => candidate.path === 'tools');
    const compareRoute = routes.find(candidate => candidate.path === 'tools/compare');
    const savedRoute = routes.find(candidate => candidate.path === 'tools/compare/saved');

    expect(toolsRoute).toBeTruthy();
    expect(toolsRoute?.canMatch).toBeUndefined();
    expect(toolsRoute?.loadComponent).toBeTypeOf('function');
    expect(toolsRoute?.data?.['title']).toBe('Workout Data Tools');
    expect(toolsRoute?.data?.['description']).toContain('compare FIT, GPX, and TCX files');
    expect(toolsRoute?.data?.['description']).toContain('saved benchmark reports');

    expect(compareRoute).toBeTruthy();
    expect(compareRoute?.canMatch).toBeUndefined();
    expect(compareRoute?.resolve).toEqual({ toolsCompareAuth: toolsCompareAuthResolver });
    expect(compareRoute?.loadComponent).toBeTypeOf('function');
    expect(compareRoute?.data?.['title']).toBe('FIT, GPX, TCX File Comparison & Benchmark Tool');
    expect(compareRoute?.data?.['description']).toContain('saved benchmark reports');
    expect(compareRoute?.data?.['description']).toContain('GNSS, heart-rate, and altitude metrics');
    expect(compareRoute?.data?.['jsonLd']).toMatchObject({
      '@type': 'WebApplication',
      name: 'FIT, GPX, TCX File Comparison & Benchmark Tool',
      operatingSystem: 'Web',
      url: 'https://quantified-self.io/tools/compare',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
    });
    const compareFeatureList = compareRoute?.data?.['jsonLd']?.['featureList'] as string[] | undefined;
    expect(compareFeatureList).toContain('Review GNSS, heart-rate, and altitude benchmark metrics');

    expect(savedRoute).toBeTruthy();
    expect(savedRoute?.resolve).toEqual({ toolsCompareAuth: toolsCompareAuthResolver });
    expect(savedRoute?.data?.['defaultTab']).toBe('saved');
    expect(savedRoute?.data?.['robots']).toBe('noindex, follow');
  });

  it('should define a public workout data comparison feature route with SEO metadata', () => {
    const route = routes.find(candidate => candidate.path === 'features/workout-data-comparison');
    const jsonLd = route?.data?.['jsonLd'] as Record<string, unknown> | undefined;

    expect(route).toBeTruthy();
    expect(route?.canMatch).toBeUndefined();
    expect(route?.loadComponent).toBeTypeOf('function');
    expect(route?.data?.['title']).toBe('Workout Data Comparison');
    expect(route?.data?.['description']).toContain('custom FIT, TCX, or GPX workout data');
    expect(route?.data?.['description']).toContain('free-plan manual uploads');
    expect(route?.data?.['description']).toContain('reviewer-ready device comparisons');
    expect(route?.data?.['keywords']).toBeUndefined();
    expect(jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Compare Garmin, Suunto, and COROS workout data',
      url: 'https://quantified-self.io/features/workout-data-comparison',
      inLanguage: 'en',
    });
  });

  it('should define public feature SEO routes with metadata and no guards', () => {
    const expectedRoutes = [
      {
        path: PUBLIC_FEATURE_PATHS.hub,
        title: 'Features for Endurance Training Data',
        h1: 'Features for endurance training data',
        descriptionText: 'sports watch benchmark reports',
      },
      {
        path: PUBLIC_FEATURE_PATHS.aiInsights,
        title: 'AI Insights for Endurance Training Data',
        h1: 'AI insights for endurance training data',
        descriptionText: 'chart-backed AI insights',
      },
      {
        path: PUBLIC_FEATURE_PATHS.workoutFileComparison,
        title: 'FIT, TCX, GPX Workout File Comparison',
        h1: 'Compare FIT, TCX, GPX, JSON, and SML workout files',
        descriptionText: 'Compare FIT, TCX, GPX, JSON, and SML workout files',
      },
      {
        path: PUBLIC_FEATURE_PATHS.fitGpxTcxFileAnalyzer,
        title: 'FIT, GPX, TCX File Analyzer',
        h1: 'Analyze FIT, GPX, and TCX workout files',
        descriptionText: 'FIT file analyzer',
      },
      {
        path: PUBLIC_FEATURE_PATHS.routeFiles,
        title: 'FIT, GPX Route Files, Suunto Route Sync, and Garmin Course Send',
        h1: 'Save FIT and GPX route files, then send them to Suunto or Garmin Connect',
        descriptionText: 'Save FIT course files and GPX route files',
      },
      {
        path: PUBLIC_FEATURE_PATHS.sportsWatchBenchmark,
        title: 'Sports Watch Benchmark Reports',
        h1: 'Sports watch benchmark reports for reviewers and device tests',
        descriptionText: 'sports watch benchmark reports',
      },
    ];

    for (const expectedRoute of expectedRoutes) {
      const route = routes.find(candidate => candidate.path === expectedRoute.path);
      const jsonLd = route?.data?.['jsonLd'] as Record<string, unknown> | undefined;
      const page = route?.data?.['publicSeoPage'] as Record<string, unknown> | undefined;

      expect(route).toBeTruthy();
      expect(route?.canMatch).toBeUndefined();
      expect(route?.loadComponent).toBeTypeOf('function');
      expect(route?.data?.['title']).toBe(expectedRoute.title);
      expect(route?.data?.['description']).toContain(expectedRoute.descriptionText);
      expect(route?.data?.['keywords']).toBeUndefined();
      expect(page?.['h1']).toBe(expectedRoute.h1);
      expect(jsonLd?.['@type']).toBe('WebPage');
      expect(jsonLd?.['url']).toBe(`https://quantified-self.io/${expectedRoute.path}`);

      if (expectedRoute.path === PUBLIC_FEATURE_PATHS.hub) {
        expect(route?.pathMatch).toBe('full');
      }
    }
  });

  it('should define a public guides hub route without requiring auth', () => {
    const route = routes.find(candidate => candidate.path === PUBLIC_GUIDE_PATHS.hub);
    const jsonLd = route?.data?.['jsonLd'] as Record<string, unknown> | undefined;
    const mainEntity = jsonLd?.['mainEntity'] as Record<string, unknown>[] | undefined;
    const page = route?.data?.['publicSeoPage'] as Record<string, unknown> | undefined;

    expect(route).toBeTruthy();
    expect(route?.canMatch).toBeUndefined();
    expect(route?.loadComponent).toBeTypeOf('function');
    expect(route?.data?.['title']).toBe('Training Data Sync Guides');
    expect(route?.data?.['description']).toContain('Garmin -> Suunto sync');
    expect(route?.data?.['keywords']).toBeUndefined();
    expect(route?.pathMatch).toBe('full');
    expect(page?.['h1']).toBe('Training data sync guides');
    expect(jsonLd?.['@type']).toBe('WebPage');
    expect(jsonLd?.['url']).toBe('https://quantified-self.io/guides');
    expect(mainEntity?.some(entity => entity['@type'] === 'HowTo')).toBe(false);
  });

  it('should define public guide SEO routes with HowTo JSON-LD', () => {
    const expectedRoutes = [
      {
        path: PUBLIC_GUIDE_PATHS.syncGarminToSuunto,
        h1: 'How to sync Garmin data to Suunto automatically',
      },
      {
        path: PUBLIC_GUIDE_PATHS.syncCorosToSuunto,
        h1: 'How to sync COROS workouts to Suunto automatically',
      },
      {
        path: PUBLIC_GUIDE_PATHS.syncSuuntoRoutesToGarmin,
        h1: 'How to sync Suunto routes to Garmin courses',
      },
      {
        path: PUBLIC_GUIDE_PATHS.centralizeWorkoutData,
        h1: 'Centralize Garmin, Suunto, and COROS workout data',
      },
    ];

    for (const expectedRoute of expectedRoutes) {
      const route = routes.find(candidate => candidate.path === expectedRoute.path);
      const jsonLd = route?.data?.['jsonLd'] as Record<string, unknown> | undefined;
      const mainEntity = jsonLd?.['mainEntity'] as Record<string, unknown>[] | undefined;
      const page = route?.data?.['publicSeoPage'] as Record<string, unknown> | undefined;

      expect(route).toBeTruthy();
      expect(route?.canMatch).toBeUndefined();
      expect(route?.loadComponent).toBeTypeOf('function');
      expect(route?.data?.['keywords']).toBeUndefined();
      expect(page?.['h1']).toBe(expectedRoute.h1);
      expect(jsonLd?.['url']).toBe(`https://quantified-self.io/${expectedRoute.path}`);
      expect(mainEntity?.some(entity => entity['@type'] === 'HowTo')).toBe(true);
    }
  });

  it('should include sync-focused metadata on the public home route', () => {
    const homeRoute = routes.find(route => route.path === '');

    expect(homeRoute).toBeTruthy();
    expect(homeRoute?.canMatch).toBeUndefined();
    expect(homeRoute?.pathMatch).toBe('full');
    expect(homeRoute?.data).toMatchObject({
      animation: 'Home',
    });
    expect(homeRoute?.data?.['description']).toBe('Quantified Self brings Garmin, Suunto, and COROS activity data into one private training dashboard with AI Insights and automatic sync from Garmin or COROS to Suunto.');
    expect(homeRoute?.data?.['keywords']).toBeUndefined();
    expect(homeRoute?.data?.['jsonLd']).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Quantified Self',
    });
  });

  it('should keep the dashboard as the authenticated app entry route', () => {
    const dashboardRoute = routes.find(route => route.path === 'dashboard');

    expect(dashboardRoute).toBeTruthy();
    expect(dashboardRoute?.canMatch).toEqual([authGuard, onboardingGuard]);
    expect(dashboardRoute?.loadChildren).toBeTypeOf('function');
  });

  it('should render a noindex not-found page for unknown routes instead of redirecting to home', () => {
    const wildcardRoute = routes.find(route => route.path === '**');

    expect(wildcardRoute).toBeTruthy();
    expect(wildcardRoute?.redirectTo).toBeUndefined();
    expect(wildcardRoute?.loadComponent).toBeTypeOf('function');
    expect(wildcardRoute?.data).toMatchObject({
      title: 'Page Not Found',
      description: 'The Quantified Self page you requested could not be found.',
      robots: 'noindex, follow',
    });
  });
});
