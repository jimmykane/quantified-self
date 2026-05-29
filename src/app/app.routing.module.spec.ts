import { describe, expect, it } from 'vitest';
import { routes } from './app.routing.module';
import { authGuard } from './authentication/app.auth.guard';
import { aiInsightsGuard } from './authentication/ai-insights.guard';
import { onboardingGuard } from './authentication/onboarding.guard';

describe('AppRoutingModule routes', () => {
  it('should define a public help route with help metadata', () => {
    const helpRoute = routes.find(route => route.path === 'help');

    expect(helpRoute).toBeTruthy();
    expect(helpRoute?.canMatch).toBeUndefined();
    expect(helpRoute?.loadComponent).toBeTypeOf('function');
    expect(helpRoute?.data).toMatchObject({
      title: 'Help & Support',
      description: 'Get help with Garmin -> Suunto and COROS -> Suunto sync routes, catch-up sync, AI Insights, account setup, uploads, billing, privacy, and troubleshooting in Quantified Self.',
      keywords: 'help, support, faq, garmin to suunto sync, coros to suunto sync, catch-up sync, ai insights, uploads, billing, privacy, quantified self',
      animation: 'Help',
      preload: true,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'Quantified Self Help & Support',
        url: 'https://www.quantified-self.io/help',
        inLanguage: 'en',
      },
    });
    const helpJsonLd = helpRoute?.data?.['jsonLd'] as Record<string, unknown> | undefined;
    const helpAbout = helpJsonLd?.['about'] as string[] | undefined;
    expect(helpAbout).toContain('Garmin -> Suunto sync');
    expect(helpAbout).toContain('COROS -> Suunto sync');
    expect(helpAbout).toContain('Catch-up sync');
  });

  it('should allow any authenticated onboarded user to access mytracks', () => {
    const myTracksRoute = routes.find(route => route.path === 'mytracks');

    expect(myTracksRoute).toBeTruthy();
    expect(myTracksRoute?.canMatch).toEqual([authGuard, onboardingGuard]);
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
      { path: 'integrations/garmin', provider: 'garmin', keyword: 'best private training dashboard for Garmin data' },
      { path: 'integrations/suunto', provider: 'suunto', keyword: 'sync Garmin data to Suunto automatically' },
      { path: 'integrations/coros', provider: 'coros', keyword: 'COROS to Suunto sync' },
    ];

    for (const expectedRoute of expectedRoutes) {
      const route = routes.find(candidate => candidate.path === expectedRoute.path);
      const jsonLd = route?.data?.['jsonLd'] as Record<string, unknown> | undefined;

      expect(route).toBeTruthy();
      expect(route?.canMatch).toBeUndefined();
      expect(route?.loadComponent).toBeTypeOf('function');
      expect(route?.data?.['integrationProvider']).toBe(expectedRoute.provider);
      expect(route?.data?.['keywords']).toContain(expectedRoute.keyword);
      expect(jsonLd?.['@type']).toBe('WebPage');
      expect(jsonLd?.['url']).toBe(`https://quantified-self.io/${expectedRoute.path}`);
    }

    const garminRoute = routes.find(candidate => candidate.path === 'integrations/garmin');
    expect(garminRoute?.data?.['title']).toBe('Private Garmin Training Dashboard');
  });

  it('should define a public workout data comparison feature route with SEO metadata', () => {
    const route = routes.find(candidate => candidate.path === 'features/workout-data-comparison');
    const jsonLd = route?.data?.['jsonLd'] as Record<string, unknown> | undefined;

    expect(route).toBeTruthy();
    expect(route?.canMatch).toBeUndefined();
    expect(route?.loadComponent).toBeTypeOf('function');
    expect(route?.data?.['title']).toBe('Workout Data Comparison');
    expect(route?.data?.['description']).toContain('Compare Garmin, Suunto, and COROS workout data');
    expect(route?.data?.['keywords']).toContain('Garmin vs COROS data');
    expect(route?.data?.['keywords']).toContain('sync Garmin data to Suunto automatically');
    expect(route?.data?.['keywords']).toContain('AI insights for endurance training data');
    expect(jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Compare Garmin, Suunto, and COROS workout data',
      url: 'https://quantified-self.io/features/workout-data-comparison',
      inLanguage: 'en',
    });
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
    expect(homeRoute?.data?.['keywords']).toContain('garmin to suunto sync');
    expect(homeRoute?.data?.['keywords']).toContain('coros to suunto sync');
    expect(homeRoute?.data?.['keywords']).toContain('ai insights');
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
});
