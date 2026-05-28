import { describe, expect, it } from 'vitest';
import { INTEGRATION_HUB_CARDS, INTEGRATIONS_HUB_ROUTE_DATA, PROVIDER_INTEGRATION_PAGES, PROVIDER_INTEGRATION_ROUTE_DATA } from './integration-pages.content';

describe('integration-pages.content', () => {
  it('should define a hub card and route metadata for each provider page', () => {
    expect(INTEGRATION_HUB_CARDS.map(card => card.slug)).toEqual(['garmin', 'suunto', 'coros']);
    expect(INTEGRATIONS_HUB_ROUTE_DATA.jsonLd['@type']).toBe('CollectionPage');

    for (const key of ['garmin', 'suunto', 'coros'] as const) {
      const page = PROVIDER_INTEGRATION_PAGES[key];
      const routeData = PROVIDER_INTEGRATION_ROUTE_DATA[key];

      expect(page.h1).toBeTruthy();
      expect(page.summary).toBeTruthy();
      expect(page.syncFlows.length).toBeGreaterThanOrEqual(3);
      expect(page.tools.length).toBeGreaterThanOrEqual(3);
      expect(page.dashboardPoints.length).toBeGreaterThanOrEqual(3);
      expect(page.faqItems.length).toBeGreaterThanOrEqual(2);
      expect(routeData.jsonLd['@type']).toBe('WebPage');
      expect(routeData.jsonLd['url']).toBe(`https://quantified-self.io/integrations/${key}`);
    }
  });

  it('should keep Garmin and COROS SEO intent distinct from the Suunto sync page', () => {
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.garmin.keywords).toContain('private Garmin training dashboard');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.garmin.title).toBe('Private Garmin Training Dashboard');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.garmin.description).toContain('Garmin -> Suunto sync');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.coros.keywords).toContain('COROS to Suunto sync');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.coros.description).toContain('centralized Garmin, Suunto, and COROS workout data');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.suunto.keywords).toContain('sync Garmin data to Suunto automatically');
  });
});
