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
      expect(routeData.title.length, `${key} title`).toBeLessThanOrEqual(60);
      expect(routeData.description.length, `${key} description`).toBeLessThanOrEqual(160);
      expect(routeData.jsonLd['@type']).toBe('WebPage');
      expect(routeData.jsonLd['url']).toBe(`https://quantified-self.io/integrations/${key}`);
    }
  });

  it('documents public Wahoo planned-workout, activity, and route delivery without claiming device receipt', () => {
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.wahoo.description).toContain('Send planned running and cycling workouts');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.wahoo.title).toBe('Wahoo Training Plans, Activity Sync, and Routes');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.wahoo.description).toContain('import FIT activities');
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.toolsCopy).toContain('QS-authored planned workouts');
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.toolsCopy).toContain('Wahoo-owned plans are not imported');
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.syncFlows.some(flow => flow.title === 'Planned workouts to Wahoo')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.syncFlows.find(flow => flow.title === 'Direct GPX/FIT course/route delivery')?.copy)
      .toContain('send flow offers a reconnect action');
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.syncFlows.some(flow => flow.title === 'Direct FIT activity delivery')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.syncFlows.some(flow => flow.title === 'Direct GPX/FIT course/route delivery')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.syncFlows.some(flow => flow.title === 'Suunto saved routes to Wahoo')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.syncFlows.some(flow => flow.title === 'Wahoo to Suunto sync')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.faqItems.some(item => item.question === 'Can I sync Wahoo activities to Suunto automatically?')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.faqItems.some(item => item.question === 'Can I send a route to Wahoo?')).toBe(true);
    const training = PROVIDER_INTEGRATION_PAGES.wahoo.faqItems.find(item => item.question === 'Can I send planned Training workouts to Wahoo?');
    expect(training?.answer).toContain('Connected Pro members');
    expect(training?.answer).toContain('time-based running and cycling');
    expect(training?.answer).toContain('not receipt by an ELEMNT computer');
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.faqItems.find(item => item.question === 'Can I send a route to Wahoo?')?.answer)
      .toContain('saved Suunto routes to Wahoo automatically');
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.faqItems.find(item => item.question.includes('disconnecting'))?.answer)
      .toContain('previously imported activities remain');
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.relatedGuideActions).toContainEqual({
      label: 'Import Activities to Wahoo',
      routerLink: '/guides/import-activities-to-wahoo',
    });
  });

  it.each([
    ['garmin', 'Planned workouts to Garmin', 'Can I send planned Training workouts to Garmin?', 'Connected Pro members'],
    ['suunto', 'Planned workouts as SuuntoPlus Guides', 'Can I send planned Training workouts to Suunto?', 'Connected Pro members'],
    ['coros', 'Planned workouts to COROS', 'Can I send planned Training workouts to COROS?', 'Not yet from the app'],
  ] as const)('documents public %s planned-workout delivery without claiming device receipt', (provider, flow, question, availability) => {
    const page = PROVIDER_INTEGRATION_PAGES[provider];
    expect(page.syncFlows.some(item => item.title === flow)).toBe(true);
    const answer = page.faqItems.find(item => item.question === question)?.answer;
    expect(answer).toContain(availability);
    expect(answer).toMatch(/does not (confirm|prove)|not proof|acceptance does not/i);
  });

  it('should keep Garmin and COROS SEO intent distinct from the Suunto sync page', () => {
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.garmin.title).toBe('Garmin Training Plans and Dashboard');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.garmin.description).toContain('planned workouts to Garmin Connect');
    expect(PROVIDER_INTEGRATION_PAGES.garmin.highlights).toContain('Send saved routes to Garmin Connect');
    expect(PROVIDER_INTEGRATION_PAGES.garmin.syncFlows.find(flow => flow.title === 'Garmin history import')?.copy)
      .toContain('latest two years selected');
    expect(PROVIDER_INTEGRATION_PAGES.suunto.tools.find(tool => tool.title === 'Suunto history, Sleep, and Health imports')?.copy)
      .toContain('latest two years selected');
    expect(PROVIDER_INTEGRATION_PAGES.coros.syncFlows.find(flow => flow.title === 'COROS history import')?.copy)
      .toContain('full rolling three-month');
    expect(PROVIDER_INTEGRATION_PAGES.wahoo.syncFlows.find(flow => flow.title === 'Wahoo history import')?.copy)
      .toContain('latest two years selected');
    expect(PROVIDER_INTEGRATION_PAGES.garmin.syncFlows.some(flow => flow.title === 'Send saved routes to Garmin Connect')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.garmin.tools.some(tool => tool.title === 'Send routes to Garmin Connect')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.garmin.tools.some(tool => tool.title === 'GPX and FIT route upload')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.garmin.faqItems.some(item => item.question === 'Can I upload a GPX or FIT route directly to Garmin?')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.garmin.faqItems.some(item => item.question === 'Can I send saved routes to Garmin Connect?')).toBe(true);
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.garmin).not.toHaveProperty('keywords');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.coros.description).toContain('planned-workout delivery is coming soon');
    expect(PROVIDER_INTEGRATION_PAGES.coros.summary).toContain('Planned-workout delivery is coming soon in the app');
    expect(PROVIDER_INTEGRATION_PAGES.coros.syncFlows.find(flow => flow.title === 'Planned workouts to COROS')?.copy)
      .toContain('New COROS plan sync and standalone Send actions are coming soon');
    expect(PROVIDER_INTEGRATION_PAGES.coros.highlights).toContain('Direct and saved route delivery to COROS');
    expect(PROVIDER_INTEGRATION_PAGES.coros.syncFlows.some(flow => flow.title === 'Send activities to COROS')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.coros.syncFlows.some(flow => flow.title === 'Send routes to COROS')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.coros.tools.some(tool => tool.title === 'GPX and FIT route delivery')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.coros.faqItems.some(item => item.question === 'Can I send routes to COROS?')).toBe(true);
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.coros).not.toHaveProperty('keywords');
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.suunto.description).toContain('planned workouts as SuuntoPlus Guides');
    expect(JSON.stringify(PROVIDER_INTEGRATION_PAGES)).not.toMatch(/\bprivate(?:ly)?\b/i);
    expect(JSON.stringify(PROVIDER_INTEGRATION_ROUTE_DATA)).not.toMatch(/\bprivate(?:ly)?\b/i);
    expect(INTEGRATION_HUB_CARDS.find(card => card.slug === 'suunto')?.summary).toContain('send Suunto routes to Garmin');
    expect(INTEGRATION_HUB_CARDS.find(card => card.slug === 'suunto')?.highlights).toContain('Send Suunto routes to Garmin');
    expect(PROVIDER_INTEGRATION_PAGES.suunto.h1).toBe('Suunto Training Plans, Activity, and Route Sync');
    expect(PROVIDER_INTEGRATION_PAGES.suunto.highlights).toContain('Automatic and existing Suunto route imports');
    expect(PROVIDER_INTEGRATION_PAGES.suunto.highlights).toContain('Send Suunto routes to Garmin');
    expect(PROVIDER_INTEGRATION_PAGES.suunto.highlights).toContain('Send Suunto routes to Wahoo');
    expect(PROVIDER_INTEGRATION_PAGES.suunto.highlights).toContain('Suunto route delivery to COROS');
    expect(PROVIDER_INTEGRATION_PAGES.suunto.tools.some(tool => tool.title === 'Suunto route import')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.suunto.tools.some(tool => tool.title === 'GPX and FIT route upload')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.suunto.tools.some(tool => tool.title === 'Send Suunto routes to Garmin')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.suunto.tools.some(tool => tool.title === 'Send Suunto routes to Wahoo')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.suunto.tools.some(tool => tool.title === 'Send Suunto routes to COROS')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.suunto.relatedGuideActions).toContainEqual({
      label: 'Import Activities to Suunto',
      routerLink: '/guides/import-activities-to-suunto',
    });
    expect(PROVIDER_INTEGRATION_PAGES.suunto.faqItems.some(item => item.question === 'Can Quantified Self sync routes with Suunto?')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.suunto.faqItems.some(item => item.question === 'Can Suunto routes sync to Garmin courses?')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.suunto.faqItems.some(item => item.question === 'Can Suunto routes sync to Wahoo?')).toBe(true);
    expect(PROVIDER_INTEGRATION_PAGES.suunto.faqItems.some(item => item.question === 'Can Suunto routes sync to COROS?')).toBe(true);
    expect(PROVIDER_INTEGRATION_ROUTE_DATA.suunto).not.toHaveProperty('keywords');
    expect(PROVIDER_INTEGRATION_PAGES.coros.tools.find(tool => tool.title === 'Daily COROS Health and sleep')?.copy)
      .toContain('every 24 hours');
    expect(PROVIDER_INTEGRATION_PAGES.coros.tools.find(tool => tool.title === 'Daily COROS Health and sleep')?.copy)
      .toContain('three-month Sleep and Health history');
    expect(PROVIDER_INTEGRATION_PAGES.coros.tools.find(tool => tool.title === 'Daily COROS Health and sleep')?.copy)
      .toContain('detailed HRV samples');
    expect(PROVIDER_INTEGRATION_PAGES.coros.tools.find(tool => tool.title === 'Daily COROS Health and sleep')?.copy)
      .toContain('does not expose sleep stages');
  });
});
