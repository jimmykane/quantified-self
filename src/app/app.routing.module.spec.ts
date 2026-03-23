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
      description: 'Get help with AI Insights, account setup, uploads, device integrations, billing, privacy, and common troubleshooting in Quantified Self.',
      keywords: 'help, support, faq, ai insights, garmin, suunto, coros, uploads, billing, privacy, quantified self',
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

  it('should include AI insights launch metadata on the public home route', () => {
    const homeRoute = routes.find(route => route.path === '');

    expect(homeRoute).toBeTruthy();
    expect(homeRoute?.data).toMatchObject({
      animation: 'Home',
    });
    expect(homeRoute?.data?.['description']).toContain('AI Insights');
    expect(homeRoute?.data?.['keywords']).toContain('ai insights');
  });
});
