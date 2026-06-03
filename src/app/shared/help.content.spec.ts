import { describe, expect, it } from 'vitest';
import { HELP_ACTIONS, HELP_SECTIONS, HelpSectionId } from './help.content';

describe('help.content', () => {
  it('should expose the expected ordered section ids', () => {
    expect(HELP_SECTIONS.map(section => section.id)).toEqual<HelpSectionId[]>([
      'getting-started',
      'ai-insights',
      'plans-and-billing',
      'uploads-and-imports',
      'service-connections',
      'data-and-privacy',
      'troubleshooting',
    ]);
  });

  it('should define seven unique sections with complete content', () => {
    expect(HELP_SECTIONS).toHaveLength(7);

    const uniqueIds = new Set(HELP_SECTIONS.map(section => section.id));
    expect(uniqueIds.size).toBe(HELP_SECTIONS.length);

    HELP_SECTIONS.forEach(section => {
      expect(section.title.trim().length).toBeGreaterThan(0);
      expect(section.summary.trim().length).toBeGreaterThan(0);
      expect(section.icon.trim().length).toBeGreaterThan(0);
      expect(section.content.trim().length).toBeGreaterThan(0);
      expect(section.links.length).toBeGreaterThan(0);

      section.links.forEach(link => {
        expect(link.label.trim().length).toBeGreaterThan(0);
        expect(link.icon.trim().length).toBeGreaterThan(0);
        expect(link.target.trim().length).toBeGreaterThan(0);
      });
    });
  });

  it('should expose four unique global support actions', () => {
    expect(HELP_ACTIONS).toHaveLength(4);

    const uniqueIds = new Set(HELP_ACTIONS.map(action => action.id));
    expect(uniqueIds.size).toBe(HELP_ACTIONS.length);

    HELP_ACTIONS.forEach(action => {
      expect(action.label.trim().length).toBeGreaterThan(0);
      expect(action.icon.trim().length).toBeGreaterThan(0);
      expect(action.target.trim().length).toBeGreaterThan(0);
    });
  });

  it('should document the dashboard recovery tile now/active/latest summary behavior', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Recovery left');
    expect(gettingStartedSection?.content).toContain('Active total');
    expect(gettingStartedSection?.content).toContain('Latest workout');
    expect(gettingStartedSection?.content).toContain('updating');
  });

  it('should document dashboard manager curated/custom/map categories', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Dashboard manager');
    expect(gettingStartedSection?.content).toContain('Manual');
    expect(gettingStartedSection?.content).toContain('Presets');
    expect(gettingStartedSection?.content).toContain('Curated');
    expect(gettingStartedSection?.content).toContain('KPI');
    expect(gettingStartedSection?.content).toContain('Custom');
    expect(gettingStartedSection?.content).toContain('Map');
    expect(gettingStartedSection?.content).toContain('one map tile');
    expect(gettingStartedSection?.content).toContain('Event search filters only the dashboard event table');
    expect(gettingStartedSection?.content).toContain('Custom** charts use their own tile date-range and activity filters');
    expect(gettingStartedSection?.content).toContain('Map** tiles use their own tile date-range and activity filters');
    expect(gettingStartedSection?.content).toContain('derived tiles stay independent from event table filters and custom/map tile filters');
    expect(gettingStartedSection?.content).toContain('dashboard can add the **Sleep** tile once');
    expect(gettingStartedSection?.content).toContain('add it manually from Dashboard manager');
    expect(gettingStartedSection?.content).toContain('removing an auto-added Sleep tile prevents future automatic Sleep tile adds');
    expect(gettingStartedSection?.content).toContain('default curated chart set');
    expect(gettingStartedSection?.content).toContain('KPI row set automatically once');
    expect(gettingStartedSection?.content).toContain('removing an auto-added curated chart or KPI prevents that chart from being suggested again');
    expect(gettingStartedSection?.content).toContain('bulk actions can add the recommended default dashboard');
    expect(gettingStartedSection?.content).toContain('add every available preset tile');
    expect(gettingStartedSection?.content).toContain('**Uploaded activities**');
    expect(gettingStartedSection?.content).toContain('current-state set: **Load Status**, **Form Now**, **Fitness Trend**, **Fatigue Trend**, **Recovery Debt**, and **Training Balance**');
    expect(gettingStartedSection?.content).toContain('Additional KPI rows such as **Fitness (CTL)**, **Fatigue (ATL)**');
  });

  it('should document that distance values follow unit preferences across the app', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Distance values in dashboards, event charts, activity chips, and CSV exports');
    expect(gettingStartedSection?.content).toContain('Dashboard **Action prompts**');
    expect(gettingStartedSection?.content).toContain('dashboard **Default units** action prompt');
    expect(gettingStartedSection?.content).toContain('Users without Pro access and no uploaded activities');
    expect(gettingStartedSection?.content).toContain('**Upload your first activities** action prompt');
    expect(gettingStartedSection?.content).toContain('FIT, GPX, TCX, JSON, or SML files');
    expect(gettingStartedSection?.content).toContain('upgrade to Pro for automatic activity sync');
    expect(gettingStartedSection?.content).toContain('manual uploads remain available from the header and upload tools');
    expect(gettingStartedSection?.content).toContain('**Connect a service** action prompt');
    expect(gettingStartedSection?.content).toContain('dismissing it hides the prompt permanently');
    expect(gettingStartedSection?.content).toContain('**Send new activities to Suunto** action prompt');
    expect(gettingStartedSection?.content).toContain('Enabling it turns on future Garmin/COROS -> Suunto imports only');
    expect(gettingStartedSection?.content).toContain('existing activities can still be queued from **Services** with Manual Catch-up');
    expect(gettingStartedSection?.content).toContain('Advanced settings');
    expect(gettingStartedSection?.content).toContain('kilometers or miles');
    expect(gettingStartedSection?.content).toContain('Settings -> Units');
    expect(gettingStartedSection?.content).toContain('jump distances display in feet when miles are selected');
  });

  it('should document event swim length tables', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Event swim length tables');
    expect(gettingStartedSection?.content).toContain('**Swim Lengths** table');
    expect(gettingStartedSection?.content).toContain('per-length pool data');
    expect(gettingStartedSection?.content).toContain('grouped into collapsed sets through the next idle/rest length');
    expect(gettingStartedSection?.content).toContain('lap index, split progress, duration, distance, length type, stroke, strokes, swim pace, cadence, heart rate, SWOLF, and energy');
    expect(gettingStartedSection?.content).toContain('25 m, 50 m, 75 m, and 100 m splits before the rest row');
  });

  it('should document event stamina metrics', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Event stamina metrics');
    expect(gettingStartedSection?.content).toContain('**Stamina** and **Potential Stamina**');
    expect(gettingStartedSection?.content).toContain('Detailed Statistics');
    expect(gettingStartedSection?.content).toContain('event summary metric tabs');
    expect(gettingStartedSection?.content).toContain('selectable chart metrics');
    expect(gettingStartedSection?.content).toContain('**Beginning Potential Stamina**');
    expect(gettingStartedSection?.content).toContain('**Ending Potential Stamina**');
  });

  it('should document non-merged event heart-rate and power zone line and fill coloring', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('provider heart-rate or power zone boundaries');
    expect(gettingStartedSection?.content).toContain('non-merged events');
    expect(gettingStartedSection?.content).toContain('Each event chart panel can use the **Overlay** button');
    expect(gettingStartedSection?.content).toContain('Right-clicking an event chart copies a themed image of the full chart panel');
    expect(gettingStartedSection?.content).toContain('**Show Swim Lengths** chart option');
    expect(gettingStartedSection?.content).toContain('swim length end boundaries');
    expect(gettingStartedSection?.content).toContain('active and idle/rest lengths are both included');
    expect(gettingStartedSection?.content).toContain('shared y-axis');
    expect(gettingStartedSection?.content).toContain('right-side y-axis');
    expect(gettingStartedSection?.content).toContain('saved globally by primary metric');
    expect(gettingStartedSection?.content).toContain('primary metric keeps its normal line and fill');
    expect(gettingStartedSection?.content).toContain('plain solid no-fill line using the overlay metric');
    expect(gettingStartedSection?.content).toContain('merged and benchmark events');
    expect(gettingStartedSection?.content).toContain('both metric and activity labels');
    expect(gettingStartedSection?.content).toContain('[Features hub](/features)');
    expect(gettingStartedSection?.content).toContain('[Workout Data Comparison](/features/workout-data-comparison)');
    expect(gettingStartedSection?.content).toContain('[Workout File Comparison](/features/workout-file-comparison)');
    expect(gettingStartedSection?.content).toContain('[Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer)');
    expect(gettingStartedSection?.content).toContain('[Sports Watch Benchmark](/features/sports-watch-benchmark)');
    expect(gettingStartedSection?.content).toContain('[File Comparison Tool](/tools/compare)');
    expect(gettingStartedSection?.content).toContain('[Tools -> Compare](/tools/compare/saved)');
    expect(gettingStartedSection?.content).toContain('sortable, filterable, paginated table with quick description notes');
    expect(gettingStartedSection?.content).toContain('uploaded FIT/TCX/GPX/JSON/SML activity files');
    expect(gettingStartedSection?.content).toContain('maps, charts');
    expect(gettingStartedSection?.content).toContain('reviewer workflows for device tests, YouTube videos, and blog posts');
    expect(gettingStartedSection?.content).toContain('Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to 100 activities');
    expect(gettingStartedSection?.content).toContain('automatic provider sync and higher limits require a paid plan');
    expect(gettingStartedSection?.content).not.toContain('overlays, AI insights, and reviewer workflows');
    expect(gettingStartedSection?.content).toContain('**Altitude** charts can color the altitude line by grade');
    expect(gettingStartedSection?.content).toContain('**Color Altitude by Grade**');
    expect(gettingStartedSection?.content).toContain('**Heart Rate** and **Power** charts color their lines and visible fill');
    expect(gettingStartedSection?.content).not.toContain('lightly tints the chart grid by zone');
  });

  it('should document the dashboard form tile CTL/ATL/TSB behavior', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Form tile (CTL / ATL / TSB)');
    expect(gettingStartedSection?.content).toContain('Training Stress Score');
    expect(gettingStartedSection?.content).toContain('Power Training Stress Score');
    expect(gettingStartedSection?.content).toContain('Current TSB');
    expect(gettingStartedSection?.content).toContain('same-day readiness');
    expect(gettingStartedSection?.content).toContain('full history');
    expect(gettingStartedSection?.content).toContain('W / M / Y');
    expect(gettingStartedSection?.content).toContain('saved on that dashboard tile');
    expect(gettingStartedSection?.content).toContain('continue to **today** with zero-load decay');
    expect(gettingStartedSection?.content).toContain('does not use slider or reload/reset toolbar controls');
    expect(gettingStartedSection?.content).toContain('Latest workout TSS');
    expect(gettingStartedSection?.content).toContain('weekly');
    expect(gettingStartedSection?.content).toContain('asynchronously');
    expect(gettingStartedSection?.content).toContain('status notice');
  });

  it('should document new derived KPI rows and curated charts', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Freshness Forecast');
    expect(gettingStartedSection?.content).toContain('Intensity Distribution');
    expect(gettingStartedSection?.content).toContain('Efficiency Trend');
    expect(gettingStartedSection?.content).toContain('saved per dashboard tile');
    expect(gettingStartedSection?.content).not.toContain('**Sleep** shows connected-source sleep duration');
    expect(gettingStartedSection?.content).toContain('ACWR');
    expect(gettingStartedSection?.content).toContain('Ramp Rate');
    expect(gettingStartedSection?.content).toContain('Monotony / Strain');
    expect(gettingStartedSection?.content).toContain('Load Status');
    expect(gettingStartedSection?.content).toContain('Form Now');
    expect(gettingStartedSection?.content).toContain('Fitness (CTL)');
    expect(gettingStartedSection?.content).toContain('Fatigue (ATL)');
    expect(gettingStartedSection?.content).toContain('Fitness Trend');
    expect(gettingStartedSection?.content).toContain('Fatigue Trend');
    expect(gettingStartedSection?.content).toContain('Recovery Debt');
    expect(gettingStartedSection?.content).toContain('Form +7d');
    expect(gettingStartedSection?.content).toContain('Training Balance');
    expect(gettingStartedSection?.content).toContain('Easy %');
    expect(gettingStartedSection?.content).toContain('Hard %');
    expect(gettingStartedSection?.content).toContain('Efficiency Δ (4w)');
    expect(gettingStartedSection?.content).toContain('Load');
    expect(gettingStartedSection?.content).toContain('Readiness');
    expect(gettingStartedSection?.content).toContain('Execution');
    expect(gettingStartedSection?.content).toContain('Current week');
    expect(gettingStartedSection?.content).toContain('Latest week');
    expect(gettingStartedSection?.content).toContain('8w / 12w / 6m / 1y / All');
    expect(gettingStartedSection?.content).toContain('Training-derived tiles do not fall back');
    expect(gettingStartedSection?.content).toContain('**info** icon');
    expect(gettingStartedSection?.content).toContain('**Today** section');
    expect(gettingStartedSection?.content).toContain('Today rows stay compact');
  });

  it('should document mobile dashboard haptic feedback behavior and fallback', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('haptic feedback');
    expect(gettingStartedSection?.content).toContain('supported mobile devices');
    expect(gettingStartedSection?.content).toContain('vibration support is unavailable');
    expect(gettingStartedSection?.content).toContain('reduced-motion is enabled');
  });

  it('should document Garmin/COROS to Suunto route-based activity sync and manual catch-up', () => {
    const serviceConnectionsSection = HELP_SECTIONS.find(section => section.id === 'service-connections');

    expect(serviceConnectionsSection?.content).toContain('Integrations hub');
    expect(serviceConnectionsSection?.content).toContain('/integrations');
    expect(serviceConnectionsSection?.content).toContain('[Training Data Sync Guides](/guides)');
    expect(serviceConnectionsSection?.content).toContain('[Tools hub](/tools)');
    expect(serviceConnectionsSection?.content).toContain('[File Comparison Tool](/tools/compare)');
    expect(serviceConnectionsSection?.content).toContain('[Features hub](/features)');
    expect(serviceConnectionsSection?.content).toContain('[Workout Data Comparison](/features/workout-data-comparison)');
    expect(serviceConnectionsSection?.content).toContain('[Workout File Comparison](/features/workout-file-comparison)');
    expect(serviceConnectionsSection?.content).toContain('[Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer)');
    expect(serviceConnectionsSection?.content).toContain('[Sports Watch Benchmark](/features/sports-watch-benchmark)');
    expect(serviceConnectionsSection?.content).toContain('[Garmin to Suunto sync guide](/guides/sync-garmin-to-suunto)');
    expect(serviceConnectionsSection?.content).toContain('[COROS to Suunto sync guide](/guides/sync-coros-to-suunto)');
    expect(serviceConnectionsSection?.content).toContain('[centralized workout data guide](/guides/centralize-garmin-suunto-coros-workout-data)');
    expect(serviceConnectionsSection?.content).toContain('uploaded FIT/TCX/GPX/JSON/SML activity files');
    expect(serviceConnectionsSection?.content).toContain('reviewer workflows for device tests, YouTube videos, and blog posts');
    expect(serviceConnectionsSection?.content).toContain('Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to 100 activities');
    expect(serviceConnectionsSection?.content).toContain('automatic provider sync and higher limits require a paid plan');
    expect(serviceConnectionsSection?.content).not.toContain('source-file workflows, AI insights, and reviewer workflows');
    expect(serviceConnectionsSection?.content).toContain('[Garmin Integration](/integrations/garmin)');
    expect(serviceConnectionsSection?.content).toContain('[COROS Integration](/integrations/coros)');
    expect(serviceConnectionsSection?.content).toContain('/integrations/suunto');
    expect(serviceConnectionsSection?.content).toContain('Suunto FIT activity uploads in Services show a per-file queue');
    expect(serviceConnectionsSection?.content).toContain('retry controls for failed files');
    expect(serviceConnectionsSection?.content).toContain('processed one file at a time with short pauses');
    expect(serviceConnectionsSection?.content).toContain('Garmin -> Suunto activity sync is route-based');
    expect(serviceConnectionsSection?.content).toContain('ACTIVITY_EXPORT');
    expect(serviceConnectionsSection?.content).toContain('Manual catch-up is available in Garmin Services');
    expect(serviceConnectionsSection?.content).toContain('convenience tool for queuing a period on demand');
    expect(serviceConnectionsSection?.content).toContain('stored original files already attached to existing Quantified Self events');
    expect(serviceConnectionsSection?.content).toContain('can run even when the Garmin -> Suunto auto-sync toggle is off');
    expect(serviceConnectionsSection?.content).toContain('dashboard may offer a one-time action prompt to enable Garmin -> Suunto auto-sync');
    expect(serviceConnectionsSection?.content).toContain('Disconnecting Garmin, COROS, or Suunto automatically disables related route auto-sync settings');
    expect(serviceConnectionsSection?.content).toContain('Sleep sync is server-owned health data');
    expect(serviceConnectionsSection?.content).toContain('14d, 30d, 90d, and 1y range control');
    expect(serviceConnectionsSection?.content).toContain('independent from dashboard event filters');
    expect(serviceConnectionsSection?.content).toContain('overlays recorded sleep HRV with an average HRV reference line');
    expect(serviceConnectionsSection?.content).toContain('Backfill Sleep History');
    expect(serviceConnectionsSection?.content).toContain('Jan 1, 2016');
    expect(serviceConnectionsSection?.content).toContain('7-day cooldown');
    expect(serviceConnectionsSection?.content).toContain('30-day cooldown');
    expect(serviceConnectionsSection?.content).toContain('one-time dashboard prompt');
    expect(serviceConnectionsSection?.content).toContain('Garmin sleep history backfill is separate from activity history import');
    expect(serviceConnectionsSection?.content).toContain('COROS -> Suunto activity sync is route-based');
    expect(serviceConnectionsSection?.content).toContain('COROS FIT activity uploads in Services use the same per-file queue');
    expect(serviceConnectionsSection?.content).toContain('short provider upload pacing');
    expect(serviceConnectionsSection?.content).toContain('enable the route toggle in COROS Services');
    expect(serviceConnectionsSection?.content).toContain('Automatic sync runs only for newly imported COROS activities');
    expect(serviceConnectionsSection?.content).toContain('Manual catch-up is available in COROS Services');
    expect(serviceConnectionsSection?.content).toContain('can run even when the COROS -> Suunto auto-sync toggle is off');
    expect(serviceConnectionsSection?.content).toContain('dashboard may offer a one-time action prompt to enable COROS -> Suunto auto-sync');
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Integrations',
      icon: 'hub',
      kind: 'route',
      target: '/integrations',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Features',
      icon: 'dashboard_customize',
      kind: 'route',
      target: '/features',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Training Guides',
      icon: 'menu_book',
      kind: 'route',
      target: '/guides',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Workout Data Comparison',
      icon: 'compare_arrows',
      kind: 'route',
      target: '/features/workout-data-comparison',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Compare Files Tool',
      icon: 'compare_arrows',
      kind: 'route',
      target: '/tools/compare',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Workout File Analyzer',
      icon: 'analytics',
      kind: 'route',
      target: '/features/fit-gpx-tcx-file-analyzer',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Garmin to Suunto Guide',
      icon: 'sync_alt',
      kind: 'route',
      target: '/guides/sync-garmin-to-suunto',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'COROS to Suunto Guide',
      icon: 'published_with_changes',
      kind: 'route',
      target: '/guides/sync-coros-to-suunto',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Centralize Workout Data',
      icon: 'hub',
      kind: 'route',
      target: '/guides/centralize-garmin-suunto-coros-workout-data',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Garmin Integration',
      icon: 'sync_alt',
      kind: 'route',
      target: '/integrations/garmin',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Suunto Integration',
      icon: 'published_with_changes',
      kind: 'route',
      target: '/integrations/suunto',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'COROS Integration',
      icon: 'sync',
      kind: 'route',
      target: '/integrations/coros',
    });
  });
});
