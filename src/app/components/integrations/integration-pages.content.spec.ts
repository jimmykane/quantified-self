import { describe, expect, it } from 'vitest';
import { INTEGRATION_HUB_CARDS, INTEGRATIONS_HUB_ROUTE_DATA, PROVIDER_INTEGRATION_PAGES, PROVIDER_INTEGRATION_ROUTE_DATA } from './integration-pages.content';

describe('integration-pages.content', () => {
  it('should define a hub card and route metadata for each provider page', () => {
    expect(INTEGRATION_HUB_CARDS.map(card => card.slug)).toEqual(['garmin', 'suunto', 'coros', 'wahoo']);
    expect(INTEGRATIONS_HUB_ROUTE_DATA.jsonLd['@type']).toBe('CollectionPage');
    expect(INTEGRATIONS_HUB_ROUTE_DATA.description).toContain('route sending');

    for (const key of ['garmin', 'suunto', 'coros', 'wahoo'] as const) {
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

  it('documents Wahoo FIT imports, activity and route delivery, Wahoo-to-Suunto sync, and retained imported activities after disconnect', () => {
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.wahoo.description).toContain('automatic FIT activity imports');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.wahoo.description).toContain('activity sync to Wahoo');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.wahoo.description).toContain('Wahoo-to-Suunto activity sync');
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.toolsCopy).toContain('accepts direct FIT activity and FIT course/route delivery');
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.toolsCopy).toContain('not the ELEMNT App');
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.toolsCopy).toContain('not enabled');
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.syncFlows.some(flow => flow.title === 'Direct FIT activity delivery')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.syncFlows.some(flow => flow.title === 'Direct FIT course/route delivery')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.syncFlows.some(flow => flow.title === 'Wahoo to Suunto sync')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.faqItems.some(item => item.question === 'Can I sync Wahoo activities to Suunto automatically?')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.faqItems.some(item => item.question === 'Can I send a route to Wahoo?')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.faqItems.find(item => item.question.includes('disconnecting'))?.answer)
      .toContain('previously imported activities remain');
  });

  it('should keep Garmin and COROS SEO intent distinct from the Suunto sync page', () => {
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.garmin.title).toBe('Private Garmin Training Dashboard');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.garmin.description).toContain('private Garmin training dashboard');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.garmin.description).toContain('routes sent to Garmin Connect');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.garmin.description).toContain('Garmin to Suunto activity sync');
    expect(PROVIDER_INTEGRATION_PAGES.garmin.highlights).toContain('Send saved routes to Garmin Connect');
    expect(PROVIDER_INTEGRATION_PAGES.garmin.syncFlows.some(flow => flow.title === 'Send saved routes to Garmin Connect')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.garmin.tools.some(tool => tool.title === 'Send routes to Garmin Connect')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.garmin.faqItems.some(item => item.question === 'Can I send saved routes to Garmin Connect?')).toBe(true);
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.garmin).not.toHaveProperty('keywords');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.coros.description).toContain('centralized Garmin, Suunto, and COROS workout data');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.coros.description).toContain('COROS to Suunto activity sync');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.coros).not.toHaveProperty('keywords');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.suunto.description).toContain('Sync Garmin and COROS activities to Suunto');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.suunto.description).toContain('import Suunto routes');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.suunto.description).toContain('send Suunto routes to Garmin');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.suunto.description).toContain('GPX routes');
    expect(INTEGRATION_HUB_CARDS.find(card => card.slug === 'suunto')?.summary).toContain('send Suunto routes to Garmin');
    expect(INTEGRATION_HUB_CARDS.find(card => card.slug === 'suunto')?.highlights).toContain('Send Suunto routes to Garmin');
    expect(PROVIDER_INTEGRATION_PAGES.suunto.h1).toBe('Suunto Integration for Activity and Route Sync');
    expect(PROVIDER_INTEGRATION_PAGES.suunto.highlights).toContain('Automatic and existing Suunto route imports');
    expect(PROVIDER_INTEGRATION_PAGES.suunto.highlights).toContain('Send Suunto routes to Garmin');
    expect(PROVIDER_INTEGRATION_PAGES.suunto.tools.some(tool => tool.title === 'Suunto route import')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.suunto.tools.some(tool => tool.title === 'Send Suunto routes to Garmin')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.suunto.faqItems.some(item => item.question === 'Can Quantified Self sync routes with Suunto?')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.suunto.faqItems.some(item => item.question === 'Can Suunto routes sync to Garmin courses?')).toBe(true);
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.suunto).not.toHaveProperty('keywords');
  });
});
