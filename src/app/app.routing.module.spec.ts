import { describe, expect, it } from 'vitest';
import type { Route } from '@angular/router';
import { routes as appRoutes } from './app.routing.module';
import { authGuard } from './authentication/app.auth.guard';
import { assistantGuard } from './authentication/assistant.guard';
import { onboardingGuard } from './authentication/onboarding.guard';
import { pricingRedirectGuard } from './authentication/pricing-redirect.guard';
import { toolsCompareAuthResolver } from './resolvers/tools-compare-auth.resolver';
import { lazyRouteResolver } from './resolvers/lazy-route.resolver';
import { PUBLIC_FEATURE_PATHS, PUBLIC_GUIDE_PATHS } from './components/public-seo/public-seo-pages.paths';
import {
  LEGACY_WORKOUT_DATA_COMPARISON_PATHS,
  WORKOUT_DATA_COMPARISON_PATH,
} from './components/features/workout-data-comparison-page.paths';
import { PublicPricingComponent } from './components/public-pricing/public-pricing.component';
import { PricingComponent } from './components/pricing/pricing.component';

const publicLayoutRoute = appRoutes.find(route => route.path === '' && Array.isArray(route.children));
const routes = [
  ...appRoutes.filter(route => route !== publicLayoutRoute),
  ...(publicLayoutRoute?.children || []),
];

async function resolvedRouteData(route: Route | undefined): Promise<Record<string, unknown>> {
  if (!route) {
    throw new Error('Expected route to exist.');
  }

  const resolvedEntries = await Promise.all(
    Object.entries(route.resolve ?? {}).map(async ([key, resolver]) => {
      if (typeof resolver !== 'function') {
        throw new Error(`Expected ${key} to use a functional resolver.`);
      }

      return [key, await (resolver as () => Promise<unknown>)()] as const;
    }),
  );

  return {
    ...route.data,
    ...Object.fromEntries(resolvedEntries),
  };
}

describe('AppRoutingModule routes', () => {
  it('disables shell cross-fades for public layout navigation', () => {
    expect(publicLayoutRoute?.data?.['disableRouteAnimation']).toBe(true);
    expect(publicLayoutRoute?.children?.some(route => route.path === 'help')).toBe(true);
  });

  it('should define a public help route with help metadata', () => {
    const helpRoute = routes.find(route => route.path === 'help');

    expect(helpRoute).toBeTruthy();
    expect(helpRoute?.canMatch).toBeUndefined();
    expect(helpRoute?.loadComponent).toBeTypeOf('function');
    expect(helpRoute?.data).toMatchObject({
      title: 'Help & Support',
      description: 'Get help with Training analysis, provider imports and sync, Wahoo activity and route delivery, read-only MCP client setup, uploads, billing, privacy, and troubleshooting.',
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
    expect(helpAbout).toContain('Training analysis');
    expect(helpAbout).toContain('Garmin to Suunto activity sync');
    expect(helpAbout).toContain('COROS to Suunto activity sync');
    expect(helpAbout).toContain('Wahoo to Suunto activity sync');
    expect(helpAbout).toContain('Send Suunto routes to Garmin');
    expect(helpAbout).toContain('Send GPX/FIT routes to Wahoo');
    expect(helpAbout).toContain('Sync past activities');
    expect(helpAbout).toContain('Read-only MCP client access');
  });

  it('defines dedicated public privacy and terms routes for reviewer-readable legal pages', () => {
    const privacyRoute = routes.find(route => route.path === 'privacy');
    const termsRoute = routes.find(route => route.path === 'terms');
    const policiesRoute = routes.find(route => route.path === 'policies');

    expect(privacyRoute?.canMatch).toBeUndefined();
    expect(privacyRoute?.loadChildren).toBeTypeOf('function');
    expect(privacyRoute?.data).toMatchObject({
      title: 'Privacy Policy',
      policyPage: 'privacy',
      description: expect.stringContaining('personal data'),
      jsonLd: {
        '@type': 'WebPage',
        url: 'https://quantified-self.io/privacy',
      },
    });
    expect(termsRoute?.canMatch).toBeUndefined();
    expect(termsRoute?.loadChildren).toBeTypeOf('function');
    expect(termsRoute?.data).toMatchObject({
      title: 'Terms of Service',
      policyPage: 'terms',
      description: expect.stringContaining('subscription'),
      jsonLd: {
        '@type': 'WebPage',
        url: 'https://quantified-self.io/terms',
      },
    });
    expect(policiesRoute?.data).toMatchObject({
      title: 'Privacy Policy & Terms',
      policyPage: 'all',
      jsonLd: {
        '@type': 'WebPage',
        url: 'https://quantified-self.io/policies',
      },
    });
  });

  it('should define a public, noindexed pricing route with live membership data', async () => {
    const pricingRoute = routes.find(route => route.path === 'pricing');
    const subscriptionsRoute = routes.find(route => route.path === 'subscriptions');

    expect(pricingRoute).toBeTruthy();
    expect(pricingRoute?.loadComponent).toBeTypeOf('function');
    expect(pricingRoute?.canMatch).toEqual([pricingRedirectGuard]);
    expect(subscriptionsRoute?.canMatch).toEqual([authGuard]);
    expect(await pricingRoute?.loadComponent?.()).toBe(PublicPricingComponent);
    expect(await subscriptionsRoute?.loadComponent?.()).toBe(PricingComponent);
    expect(pricingRoute?.data?.['title']).toBe('Membership');
    expect(pricingRoute?.data?.['description']).toContain('Support the development of Quantified Self');
    expect(pricingRoute?.data?.['keywords']).toBeUndefined();
    expect(pricingRoute?.data?.['robots']).toBe('noindex, nofollow');
    expect(pricingRoute?.data?.['jsonLd']).toBeUndefined();
  });

  it('should allow any authenticated onboarded user to access mytracks', () => {
    const myTracksRoute = routes.find(route => route.path === 'mytracks');

    expect(myTracksRoute).toBeTruthy();
    expect(myTracksRoute?.canMatch).toEqual([authGuard, onboardingGuard]);
    expect(myTracksRoute?.data?.['disableRouteAnimation']).toBe(true);
  });

  it('should skip the shell cross-fade when opening Training', () => {
    const trainingRoute = routes.find(route => route.path === 'training');

    expect(trainingRoute).toBeTruthy();
    expect(trainingRoute?.canMatch).toEqual([authGuard, onboardingGuard]);
    expect(trainingRoute?.data?.['disableRouteAnimation']).toBe(true);
    expect(trainingRoute?.data?.['description']).toContain('Training analysis');
    expect(trainingRoute?.data?.['description']).not.toMatch(/\bprivate\b/i);
    expect(trainingRoute?.data?.['robots']).toBe('noindex, follow');
  });

  it('keeps Health authenticated, available to every onboarded user, and noindexed', () => {
    const healthRoute = routes.find(route => route.path === 'health');

    expect(healthRoute).toBeTruthy();
    expect(healthRoute?.canMatch).toEqual([authGuard, onboardingGuard]);
    expect(healthRoute?.loadComponent).toBeTypeOf('function');
    expect(healthRoute?.data).toMatchObject({
      title: 'Health',
      preload: true,
      animation: 'Health',
      robots: 'noindex, follow',
    });
    expect(healthRoute?.data?.['description']).toContain('source-separated');
  });

  it('should keep the activity calendar authenticated and noindexed', () => {
    const calendarRoute = routes.find(route => route.path === 'calendar');

    expect(calendarRoute).toBeTruthy();
    expect(calendarRoute?.canMatch).toEqual([authGuard, onboardingGuard]);
    expect(calendarRoute?.data?.['description']).toContain('Week, Month, and Year activity calendar');
    expect(calendarRoute?.data?.['description']).not.toMatch(/\bprivate\b/i);
    expect(calendarRoute?.data?.['robots']).toBe('noindex, follow');
  });

  it('should keep the private routes library authenticated and noindexed', () => {
    const routesRoute = routes.find(route => route.path === 'routes');

    expect(routesRoute).toBeTruthy();
    expect(routesRoute?.canMatch).toEqual([authGuard, onboardingGuard]);
    expect(routesRoute?.data?.['robots']).toBe('noindex, follow');
  });

  it('should keep route-detail hydration behind its authenticated lazy resolver', () => {
    const routeDetailRoute = routes.find(route => route.path === 'user/:userID/route/:routeID');

    expect(routeDetailRoute?.canMatch).toEqual([authGuard, onboardingGuard]);
    expect(routeDetailRoute?.loadComponent).toBeTypeOf('function');
    expect(routeDetailRoute?.resolve).toEqual({ route: lazyRouteResolver });
  });

  it('allows authenticated onboarded users to manage MCP from Connections', () => {
    const servicesRoute = routes.find(route => route.path === 'services');

    expect(servicesRoute).toBeTruthy();
    expect(servicesRoute?.canMatch).toEqual([authGuard, onboardingGuard]);
    expect(servicesRoute?.loadChildren).toBeTypeOf('function');
  });

  it('should keep MCP consent authenticated and out of search indexes', () => {
    const mcpAuthorizationRoute = routes.find(route => route.path === 'mcp/authorize');

    expect(mcpAuthorizationRoute).toBeTruthy();
    expect(mcpAuthorizationRoute?.canMatch).toEqual([authGuard]);
    expect(mcpAuthorizationRoute?.loadComponent).toBeTypeOf('function');
    expect(mcpAuthorizationRoute?.data?.['robots']).toBe('noindex, nofollow');
  });

  it('should define unguarded noindexed public share routes', () => {
    const eventShareRoute = routes.find(route => route.path === 'share/event/:userID/:eventID');
    const comparisonShareRoute = routes.find(route => route.path === 'share/comparison/:userID/:eventID');

    expect(eventShareRoute?.canMatch).toBeUndefined();
    expect(eventShareRoute?.loadChildren).toBeTypeOf('function');
    expect(eventShareRoute?.data).toMatchObject({
      publicShare: true,
      shareKind: 'event',
      robots: 'noindex, nofollow',
    });

    expect(comparisonShareRoute?.canMatch).toBeUndefined();
    expect(comparisonShareRoute?.loadChildren).toBeTypeOf('function');
    expect(comparisonShareRoute?.data).toMatchObject({
      publicShare: true,
      shareKind: 'comparison',
      openBenchmarkOnLoad: true,
      robots: 'noindex, nofollow',
    });
  });

  it('should protect the Assistant behind auth, onboarding, and configured quota access', () => {
    const assistantRoute = routes.find(route => route.path === 'ai-insights');

    expect(assistantRoute).toBeTruthy();
    expect(assistantRoute?.canMatch).toEqual([authGuard, onboardingGuard, assistantGuard]);
    expect(assistantRoute?.loadComponent).toBeTypeOf('function');
    expect(assistantRoute?.data).toMatchObject({
      title: 'Assistant',
      preload: true,
      animation: 'Assistant',
    });
  });

  it('should define a public integrations hub route with lazily resolved collection metadata', async () => {
    const integrationsRoute = routes.find(route => route.path === 'integrations');
    const routeData = await resolvedRouteData(integrationsRoute);

    expect(integrationsRoute).toBeTruthy();
    expect(integrationsRoute?.canMatch).toBeUndefined();
    expect(integrationsRoute?.loadComponent).toBeTypeOf('function');
    expect(integrationsRoute?.data).toMatchObject({
      preload: true,
      animation: 'Integrations',
    });
    expect(integrationsRoute?.data?.['title']).toBeUndefined();
    expect(routeData).toMatchObject({
      title: 'Integrations',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Quantified Self Integrations',
        url: 'https://quantified-self.io/integrations',
        inLanguage: 'en',
      },
    });
    expect(routeData['description']).toContain('Garmin, Suunto, COROS, and Wahoo integrations');
  });

  it('should define public Garmin, Suunto, COROS, and Wahoo provider integration routes', async () => {
    const expectedRoutes = [
      { path: 'integrations/garmin', provider: 'garmin', descriptionText: 'Garmin training dashboard' },
      { path: 'integrations/suunto', provider: 'suunto', descriptionText: 'Sync Garmin and COROS activities to Suunto' },
      { path: 'integrations/coros', provider: 'coros', descriptionText: 'COROS to Suunto activity sync' },
      { path: 'integrations/wahoo', provider: 'wahoo', descriptionText: 'Automatic FIT activity imports' },
    ];

    for (const expectedRoute of expectedRoutes) {
      const route = routes.find(candidate => candidate.path === expectedRoute.path);
      const routeData = await resolvedRouteData(route);
      const jsonLd = routeData['jsonLd'] as Record<string, unknown> | undefined;

      expect(route).toBeTruthy();
      expect(route?.canMatch).toBeUndefined();
      expect(route?.loadComponent).toBeTypeOf('function');
      expect(route?.data).toMatchObject({
        preload: true,
        animation: 'Integrations',
      });
      expect(route?.data?.['title']).toBeUndefined();
      expect(route?.data?.['integrationProvider']).toBe(expectedRoute.provider);
      expect(routeData['keywords']).toBeUndefined();
      expect(routeData['description']).toContain(expectedRoute.descriptionText);
      expect(jsonLd?.['@type']).toBe('WebPage');
      expect(jsonLd?.['url']).toBe(`https://quantified-self.io/${expectedRoute.path}`);
    }

    const garminRoute = routes.find(candidate => candidate.path === 'integrations/garmin');
    expect((await resolvedRouteData(garminRoute))['title']).toBe('Garmin Training Dashboard');
  });

  it('should define public tools routes with compare workflow metadata', () => {
    const toolsRoute = routes.find(candidate => candidate.path === 'tools');
    const compareRoute = routes.find(candidate => candidate.path === 'tools/compare');
    const savedRoute = routes.find(candidate => candidate.path === 'tools/compare/saved');

    expect(toolsRoute).toBeTruthy();
    expect(toolsRoute?.canMatch).toBeUndefined();
    expect(toolsRoute?.loadComponent).toBeTypeOf('function');
    expect(toolsRoute?.data?.['title']).toBe('Workout Data Tools');
    expect(toolsRoute?.data?.['description']).toContain('compare FIT, GPX, TCX, JSON, and SML files');
    expect(toolsRoute?.data?.['description']).toContain('saved benchmark reports');

    expect(compareRoute).toBeTruthy();
    expect(compareRoute?.canMatch).toBeUndefined();
    expect(compareRoute?.resolve).toEqual({ toolsCompareAuth: toolsCompareAuthResolver });
    expect(compareRoute?.loadComponent).toBeTypeOf('function');
    expect(compareRoute?.data?.['title']).toBe('FIT, GPX, TCX, JSON & SML Benchmark Tool Trusted by Device Reviewers');
    expect(compareRoute?.data?.['description']).toContain('trusted by device reviewers');
    expect(compareRoute?.data?.['description']).toContain('GNSS, heart-rate, altitude, power');
    expect(compareRoute?.data?.['description']).toContain('all other device metrics');
    expect(compareRoute?.data?.['jsonLd']).toMatchObject({
      '@type': 'WebApplication',
      name: 'FIT, GPX, TCX, JSON & SML File Comparison & Benchmark Tool',
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

  it('should define a public workout data comparison feature route with lazily resolved SEO metadata', async () => {
    const route = routes.find(candidate => candidate.path === 'features/workout-data-comparison');
    const routeData = await resolvedRouteData(route);
    const jsonLd = routeData['jsonLd'] as Record<string, unknown> | undefined;

    expect(route).toBeTruthy();
    expect(route?.canMatch).toBeUndefined();
    expect(route?.loadComponent).toBeTypeOf('function');
    expect(route?.data).toMatchObject({
      preload: true,
      animation: 'Features',
    });
    expect(route?.data?.['title']).toBeUndefined();
    expect(routeData['title']).toBe('Workout File, Provider & Sports Device Comparison');
    expect(routeData['description']).toContain('Garmin, Suunto, COROS, Wahoo, FIT, TCX, GPX, JSON, and SML');
    expect(routeData['description']).toContain('reviewer-ready benchmarks');
    expect(routeData['keywords']).toBeUndefined();
    expect(jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Compare workout files, providers, and sports devices',
      url: 'https://quantified-self.io/features/workout-data-comparison',
      inLanguage: 'en',
    });
  });

  it('redirects legacy comparison URLs to the consolidated feature page', () => {
    for (const path of LEGACY_WORKOUT_DATA_COMPARISON_PATHS) {
      const route = routes.find(candidate => candidate.path === path);

      expect(route).toMatchObject({
        path,
        redirectTo: WORKOUT_DATA_COMPARISON_PATH,
        pathMatch: 'full',
      });
      expect(route?.loadComponent).toBeUndefined();
      expect(route?.resolve).toBeUndefined();
    }
  });

  it('should define a public supported activities feature route with lazily resolved SEO metadata', async () => {
    const route = routes.find(candidate => candidate.path === 'features/supported-activities');
    const routeData = await resolvedRouteData(route);
    const jsonLd = routeData['jsonLd'] as Record<string, unknown> | undefined;

    expect(route).toBeTruthy();
    expect(route?.canMatch).toBeUndefined();
    expect(route?.loadComponent).toBeTypeOf('function');
    expect(route?.data).toMatchObject({
      preload: true,
      animation: 'Features',
    });
    expect(routeData['title']).toBe('Supported Activity Types');
    expect(routeData['description']).toContain('activity types Quantified Self recognizes');
    expect(routeData['description']).toContain('maps, metrics, laps, charts, and sport-specific details');
    expect(routeData['keywords']).toBeUndefined();
    expect(jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Supported Activity Types',
      url: 'https://quantified-self.io/features/supported-activities',
      inLanguage: 'en',
    });
  });

  it('should define public feature SEO routes with lazily resolved metadata and no guards', async () => {
    const expectedRoutes = [
      {
        path: PUBLIC_FEATURE_PATHS.hub,
        title: 'Features for Endurance Training Data',
        h1: 'Features for endurance training data',
        descriptionText: 'training analysis, maps, dashboards, comparisons, and AI answers',
      },
      {
        path: PUBLIC_FEATURE_PATHS.activityCalendar,
        title: 'Activity Calendar for Endurance Training',
        h1: 'Activity calendar for endurance training',
        descriptionText: 'Week, Month, and Year calendar views',
      },
      {
        path: PUBLIC_FEATURE_PATHS.trainingAnalysis,
        title: 'Training Analysis for Endurance Athletes',
        h1: 'Training analysis for endurance athletes',
        descriptionText: 'training load, readiness, intensity, durability, sleep, power, and sport-specific trends',
      },
      {
        path: PUBLIC_FEATURE_PATHS.trainingDashboard,
        title: 'Custom Training Dashboard for Endurance Athletes',
        h1: 'Build the training dashboard you need',
        descriptionText: 'KPI, chart, and map tiles, independent filters',
      },
      {
        path: PUBLIC_FEATURE_PATHS.activityMap,
        title: 'Activity Map and Automatic Trip Detection',
        h1: 'See workouts, trips, and destinations on one map',
        descriptionText: 'Map GPS workouts, filter by sport or date',
      },
      {
        path: PUBLIC_FEATURE_PATHS.mcpServer,
        title: 'Read-only MCP Server for Training Data',
        h1: 'Connect ChatGPT or Claude to your training data',
        descriptionText: 'ChatGPT, Claude, or another MCP client',
      },
      {
        path: PUBLIC_FEATURE_PATHS.assistant,
        title: 'AI Training Assistant Grounded in Your Fitness Data',
        h1: 'If you could ask your training history one question, what would it be?',
        descriptionText: 'grounded in your recorded data',
      },
      {
        path: PUBLIC_FEATURE_PATHS.fitGpxTcxFileAnalyzer,
        title: 'FIT, GPX, TCX File Analyzer',
        h1: 'Analyze FIT, GPX, and TCX workout files',
        descriptionText: 'Upload FIT, GPX, TCX, JSON, or SML workouts',
      },
      {
        path: PUBLIC_FEATURE_PATHS.routeFiles,
        title: 'FIT and GPX Route Files with Multi-Provider Delivery',
        h1: 'Save FIT and GPX route files, then send them to connected services',
        descriptionText: 'Save FIT courses and GPX routes',
      },
    ];

    for (const expectedRoute of expectedRoutes) {
      const route = routes.find(candidate => candidate.path === expectedRoute.path);
      const routeData = await resolvedRouteData(route);
      const jsonLd = routeData['jsonLd'] as Record<string, unknown> | undefined;
      const page = routeData['publicSeoPage'] as Record<string, unknown> | undefined;

      expect(route).toBeTruthy();
      expect(route?.canMatch).toBeUndefined();
      expect(route?.loadComponent).toBeTypeOf('function');
      expect(route?.data).toMatchObject({
        preload: true,
        animation: 'PublicSeo',
      });
      expect(route?.data?.['title']).toBeUndefined();
      expect(routeData['title']).toBe(expectedRoute.title);
      expect(routeData['description']).toContain(expectedRoute.descriptionText);
      expect(routeData['keywords']).toBeUndefined();
      expect(page?.['h1']).toBe(expectedRoute.h1);
      expect(jsonLd?.['@type']).toBe('WebPage');
      expect(jsonLd?.['url']).toBe(`https://quantified-self.io/${expectedRoute.path}`);

      if (expectedRoute.path === PUBLIC_FEATURE_PATHS.hub) {
        expect(route?.pathMatch).toBe('full');
      }
    }
  });

  it('should define a public guides hub route without requiring auth', async () => {
    const route = routes.find(candidate => candidate.path === PUBLIC_GUIDE_PATHS.hub);
    const routeData = await resolvedRouteData(route);
    const jsonLd = routeData['jsonLd'] as Record<string, unknown> | undefined;
    const mainEntity = jsonLd?.['mainEntity'] as Record<string, unknown>[] | undefined;
    const page = routeData['publicSeoPage'] as Record<string, unknown> | undefined;

    expect(route).toBeTruthy();
    expect(route?.canMatch).toBeUndefined();
    expect(route?.loadComponent).toBeTypeOf('function');
    expect(route?.data).toMatchObject({
      preload: true,
      animation: 'PublicSeo',
    });
    expect(route?.data?.['title']).toBeUndefined();
    expect(routeData['title']).toBe('Training Data Sync Guides');
    expect(routeData['description']).toContain('Garmin to Suunto activity sync');
    expect(routeData['keywords']).toBeUndefined();
    expect(route?.pathMatch).toBe('full');
    expect(page?.['h1']).toBe('Training data sync guides');
    expect(jsonLd?.['@type']).toBe('WebPage');
    expect(jsonLd?.['url']).toBe('https://quantified-self.io/guides');
    expect(mainEntity?.some(entity => entity['@type'] === 'HowTo')).toBe(false);
  });

  it('should define public guide SEO routes with lazily resolved HowTo JSON-LD', async () => {
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
        path: PUBLIC_GUIDE_PATHS.syncWahooToSuunto,
        h1: 'How to sync Wahoo activities to Suunto automatically',
      },
      {
        path: PUBLIC_GUIDE_PATHS.importActivitiesToSuunto,
        h1: 'How to import activities to Suunto',
      },
      {
        path: PUBLIC_GUIDE_PATHS.importActivitiesToWahoo,
        h1: 'How to import activities to Wahoo',
      },
      {
        path: PUBLIC_GUIDE_PATHS.syncSuuntoRoutesToGarmin,
        h1: 'How to send Suunto routes to Garmin courses',
      },
      {
        path: PUBLIC_GUIDE_PATHS.centralizeWorkoutData,
        h1: 'Centralize Garmin, Suunto, COROS, and Wahoo workout data',
      },
    ];

    for (const expectedRoute of expectedRoutes) {
      const route = routes.find(candidate => candidate.path === expectedRoute.path);
      const routeData = await resolvedRouteData(route);
      const jsonLd = routeData['jsonLd'] as Record<string, unknown> | undefined;
      const mainEntity = jsonLd?.['mainEntity'] as Record<string, unknown>[] | undefined;
      const page = routeData['publicSeoPage'] as Record<string, unknown> | undefined;

      expect(route).toBeTruthy();
      expect(route?.canMatch).toBeUndefined();
      expect(route?.loadComponent).toBeTypeOf('function');
      expect(route?.data).toMatchObject({
        preload: true,
        animation: 'PublicSeo',
      });
      expect(route?.data?.['title']).toBeUndefined();
      expect(routeData['keywords']).toBeUndefined();
      expect(page?.['h1']).toBe(expectedRoute.h1);
      expect(jsonLd?.['url']).toBe(`https://quantified-self.io/${expectedRoute.path}`);
      expect(mainEntity?.some(entity => entity['@type'] === 'HowTo')).toBe(true);
    }
  });

  it('should include integration and MCP metadata on the public home route', () => {
    const homeRoute = routes.find(route => route.path === '');

    expect(homeRoute).toBeTruthy();
    expect(homeRoute?.canMatch).toBeUndefined();
    expect(homeRoute?.pathMatch).toBe('full');
    expect(homeRoute?.data).toMatchObject({
      title: 'Training Dashboard',
      animation: 'Home',
    });
    expect(homeRoute?.data?.['description']).toBe('Connect Garmin, Suunto, COROS, and Wahoo in one training dashboard. Analyze readiness, training load, sleep, routes, and performance trends.');
    expect(homeRoute?.data?.['keywords']).toBeUndefined();
    expect(homeRoute?.data?.['jsonLd']).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Quantified Self',
    });
    expect(homeRoute?.data?.['jsonLd']?.['featureList']).toContain('Week, Month, and Year activity calendar with duration-scaled activity groups');
    expect(homeRoute?.data?.['jsonLd']?.['featureList']).toContain('Curated training analysis for readiness, load, intensity, durability, sleep context, and best builds');
    expect(homeRoute?.data?.['jsonLd']?.['featureList']).toContain('Automatic Wahoo to Suunto activity sync');
    expect(homeRoute?.data?.['jsonLd']?.['featureList']).toContain('Activity and route delivery to Wahoo');
    expect(homeRoute?.data?.['jsonLd']?.['featureList']).toContain('Read-only MCP access for compatible clients');
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
