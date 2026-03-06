import { describe, expect, it } from 'vitest';
import { routes } from './app.routing.module';

describe('AppRoutingModule routes', () => {
  it('should define a public help route with help metadata', () => {
    const helpRoute = routes.find(route => route.path === 'help');

    expect(helpRoute).toBeTruthy();
    expect(helpRoute?.canMatch).toBeUndefined();
    expect(helpRoute?.loadComponent).toBeTypeOf('function');
    expect(helpRoute?.data).toMatchObject({
      title: 'Help & Support',
      description: 'Get help with account setup, uploads, device integrations, billing, privacy, and common troubleshooting in Quantified Self.',
      keywords: 'help, support, faq, garmin, suunto, coros, uploads, billing, privacy, quantified self',
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
});
