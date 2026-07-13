import { describe, expect, it } from 'vitest';
import { HELP_ACTIONS, HELP_SECTIONS, HelpSectionId } from './help.content';
import { ROUTE_USAGE_LIMITS, USAGE_LIMITS } from '../../../shared/limits';
import {
  POLICIES_AI_AND_PROCESSORS_FRAGMENT,
  POLICIES_CONNECTED_SERVICES_FRAGMENT,
  POLICIES_COROS_DATA_FRAGMENT,
  POLICIES_GARMIN_DATA_FRAGMENT,
  POLICIES_SUUNTO_DATA_FRAGMENT,
} from './policies.content';

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
    expect(gettingStartedSection?.content).toContain('one activity map and one saved-routes map');
    expect(gettingStartedSection?.content).toContain('Event search filters only the dashboard event table');
    expect(gettingStartedSection?.content).toContain('Event tags can be added from an event row or event details');
    expect(gettingStartedSection?.content).toContain('exact tag filter');
    expect(gettingStartedSection?.content).toContain('up to 250 selected events');
    expect(gettingStartedSection?.content).toContain('atomic add/remove tag changes in bulk');
    expect(gettingStartedSection?.content).toContain('tags are visible on public event and comparison links');
    expect(gettingStartedSection?.content).toContain('Custom** charts use their own tile date-range and activity filters');
    expect(gettingStartedSection?.content).toContain('Map** tiles can use activity events or saved route previews');
    expect(gettingStartedSection?.content).toContain('Routes** map tiles show recent saved routes from lightweight route previews');
    expect(gettingStartedSection?.content).toContain('derived tiles stay independent from event table filters and custom/map tile filters');
    expect(gettingStartedSection?.content).toContain('New dashboards start clean');
    expect(gettingStartedSection?.content).toContain('Open Training');
    expect(gettingStartedSection?.content).toContain('baseline comparisons');
    expect(gettingStartedSection?.content).toContain('Simplify dashboard');
    expect(gettingStartedSection?.content).toContain('does not automatically add sleep, KPI, curated training, or power-curve tiles');
    expect(gettingStartedSection?.content).toContain('It can add a **Routes** map once saved routes have generated previews');
    expect(gettingStartedSection?.content).toContain('add every available preset tile');
    expect(gettingStartedSection?.content).toContain('**Uploaded activities**');
    expect(gettingStartedSection?.content).toContain('Load and recovery interpretation lives in **Training**');
    expect(gettingStartedSection?.content).toContain('Notable changes');
    expect(gettingStartedSection?.content).toContain('zero-session result');
    expect(gettingStartedSection?.content).toContain('groups chart and map tiles by intent');
    expect(gettingStartedSection?.content).toContain('**Activity Overview**, **Routes & Maps**, and **Custom Charts**');
    expect(gettingStartedSection?.content).toContain('Custom charts are placed in those dashboard sections automatically');
    expect(gettingStartedSection?.content).toContain('chart-aware default sizes');
    expect(gettingStartedSection?.content).toContain('Empty editable dashboards show lightweight section guidance');
    expect(gettingStartedSection?.content).toContain('**Cycling Power Curve** and **Running Power Curve** are curated derived snapshots');
    expect(gettingStartedSection?.content).toContain('defaults to **1y**');
    expect(gettingStartedSection?.content).toContain('latest activity or a saved recent-best comparison window');
    expect(gettingStartedSection?.content).toContain('Device VO2 Max');
    expect(gettingStartedSection?.content).toContain('never as a readiness score');
  });

  it('should document that distance values follow unit preferences across the app', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Distance values in dashboards, event charts, activity chips, and CSV exports');
    expect(gettingStartedSection?.content).toContain('Dashboard **Action prompts**');
    expect(gettingStartedSection?.content).toContain('dashboard **Default units** action prompt');
    expect(gettingStartedSection?.content).toContain('**No activities yet**');
    expect(gettingStartedSection?.content).toContain('**Upload activity**');
    expect(gettingStartedSection?.content).toContain('**Connect service**');
    expect(gettingStartedSection?.content).toContain('FIT, GPX, TCX, JSON, and SML files');
    expect(gettingStartedSection?.content).toContain('Garmin, Suunto, and COROS');
    expect(gettingStartedSection?.content).toContain('after activity data exists');
    expect(gettingStartedSection?.content).toContain('Pro users with activity data but without a connected activity service');
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
    expect(gettingStartedSection?.content).toContain('[FIT and GPX Route Files](/features/fit-gpx-route-files)');
    expect(gettingStartedSection?.content).toContain('[Sports Watch Benchmark](/features/sports-watch-benchmark)');
    expect(gettingStartedSection?.content).toContain('[File Comparison Tool](/tools/compare)');
    expect(gettingStartedSection?.content).toContain('[Tools -> Compare](/tools/compare/saved)');
    expect(gettingStartedSection?.content).toContain('sortable, filterable, paginated table with device, activity type, and review tag filters, selected-row bulk delete, distance, ascent, descent, visible benchmark pairs, GNSS/heart-rate/altitude benchmark error metrics colored by low/moderate/high error, clickable draft metric cells that open the benchmark flow, quick description notes, and custom reviewer tags');
    expect(gettingStartedSection?.content).toContain('Benchmark reports show an **At a Glance** reviewer summary');
    expect(gettingStartedSection?.content).toContain('report share menu can copy that summary');
    expect(gettingStartedSection?.content).toContain('account-level device color preferences from saved file comparisons');
    expect(gettingStartedSection?.content).toContain('keyed by the base device name rather than firmware/software version');
    expect(gettingStartedSection?.content).toContain('activity toggles, event tables, benchmark dialogs, charts, and maps');
    expect(gettingStartedSection?.content).toContain('uploaded FIT/TCX/GPX/JSON/SML activity files');
    expect(gettingStartedSection?.content).toContain('maps, charts');
    expect(gettingStartedSection?.content).toContain('reviewer workflows for device tests, YouTube videos, and blog posts');
    expect(gettingStartedSection?.content).toContain(`Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to ${USAGE_LIMITS.free} activities and ${ROUTE_USAGE_LIMITS.free} saved routes`);
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
    expect(gettingStartedSection?.content).toContain('Cycling Power Curve');
    expect(gettingStartedSection?.content).toContain('Running Power Curve');
    expect(gettingStartedSection?.content).toContain('prepared PowerCurve snapshot');
    expect(gettingStartedSection?.content).toContain('latest activity, best last 30d, or best last 90d');
    expect(gettingStartedSection?.content).toContain('Cycling and running power data stay in separate tiles');
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
    expect(gettingStartedSection?.content).toContain('Dashboard **Today** header');
    expect(gettingStartedSection?.content).toContain('Today rows stay compact');
    expect(gettingStartedSection?.content).toContain('KPI detail rows');
    expect(gettingStartedSection?.content).toContain('freshness date');
    expect(gettingStartedSection?.content).toContain('metric-specific');
  });

  it('should document mobile dashboard haptic feedback behavior and fallback', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('haptic feedback');
    expect(gettingStartedSection?.content).toContain('supported mobile devices');
    expect(gettingStartedSection?.content).toContain('vibration support is unavailable');
    expect(gettingStartedSection?.content).toContain('reduced-motion is enabled');
  });

  it('should document selected-row GPX export options', () => {
    const uploadsSection = HELP_SECTIONS.find(section => section.id === 'uploads-and-imports');

    expect(uploadsSection?.content).toContain('CSV export, GPX export, and original-file download actions support your current multi-selection');
    expect(uploadsSection?.content).toContain('multi-selected GPX exports download as a ZIP');
  });

  it('should document Garmin saved-route delivery requirements and behavior', () => {
    const serviceConnectionsSection = HELP_SECTIONS.find(section => section.id === 'service-connections');

    expect(serviceConnectionsSection?.content).toContain('Garmin saved-route delivery to Garmin Connect');
    expect(serviceConnectionsSection?.content).toContain('Saved FIT and GPX routes can also be sent to Garmin Connect from **Routes**');
    expect(serviceConnectionsSection?.content).toContain('not a Garmin route import or catch-up feature');
    expect(serviceConnectionsSection?.content).toContain('**COURSE_IMPORT**');
    expect(serviceConnectionsSection?.content).toContain('Routes can show a Garmin permission prompt');
    expect(serviceConnectionsSection?.content).toContain('updates the same Garmin course on resend for the same Garmin account');
  });

  it('should document Suunto to Garmin route delivery requirements and manual queue scope', () => {
    const serviceConnectionsSection = HELP_SECTIONS.find(section => section.id === 'service-connections');

    expect(serviceConnectionsSection?.content).toContain('**Suunto -> Garmin course delivery**');
    expect(serviceConnectionsSection?.content).toContain('Suunto -> Garmin course delivery, manual catch-up');
    expect(serviceConnectionsSection?.content).toContain('one-time **Routes** page action prompt');
    expect(serviceConnectionsSection?.content).toContain('already saved in Quantified Self to Garmin as courses');
    expect(serviceConnectionsSection?.content).toContain('requires Garmin to be connected with **COURSE_IMPORT** permission');
    expect(serviceConnectionsSection?.content).toContain('**Queue now** action is a convenience backfill');
    expect(serviceConnectionsSection?.content).toContain('does not fetch routes from Suunto or Garmin');
    expect(serviceConnectionsSection?.content).toContain('[Suunto routes to Garmin courses guide](/guides/sync-suunto-routes-to-garmin-courses)');
    expect(serviceConnectionsSection?.links?.some(link => link.target === '/guides/sync-suunto-routes-to-garmin-courses')).toBe(true);
  });

  it('should document activity and route limits in plans and uploads help', () => {
    const plansSection = HELP_SECTIONS.find(section => section.id === 'plans-and-billing');
    const uploadsSection = HELP_SECTIONS.find(section => section.id === 'uploads-and-imports');

    expect(plansSection?.content).toContain(`Up to **${USAGE_LIMITS.free} activities**`);
    expect(plansSection?.content).toContain(`Up to **${ROUTE_USAGE_LIMITS.free} saved routes**`);
    expect(plansSection?.content).toContain(`Up to **${USAGE_LIMITS.basic.toLocaleString('en-US')} activities**`);
    expect(plansSection?.content).toContain(`Up to **${ROUTE_USAGE_LIMITS.basic} saved routes**`);
    expect(plansSection?.content).toContain('**Unlimited saved routes**');
    expect(plansSection?.content).toContain('Existing activities and routes are retained. New uploads follow your current plan limits.');
    expect(uploadsSection?.content).toContain(`**Starter** includes up to **${ROUTE_USAGE_LIMITS.free} saved routes**`);
    expect(uploadsSection?.content).toContain(`**Basic** includes up to **${ROUTE_USAGE_LIMITS.basic} saved routes**`);
    expect(uploadsSection?.content).toContain("You may have reached your current plan's activity or route limit.");
    expect(uploadsSection?.content).toContain('[FIT and GPX Route Files](/features/fit-gpx-route-files)');
    expect(uploadsSection?.content).toContain('Saved routes open from **Routes** with the details action.');
    expect(uploadsSection?.content).toContain('waypoints and turn instructions');
    expect(uploadsSection?.content).toContain('parsed points and streams are not saved back to Firestore');
    expect(uploadsSection?.content).toContain('lightweight encoded route preview for route-table thumbnails and dashboard route maps');
    expect(uploadsSection?.content).toContain('older saved routes need a reprocess or controlled backfill before they appear with previews');
    expect(uploadsSection?.links).toContainEqual({
      label: 'FIT and GPX Route Files',
      icon: 'route',
      kind: 'route',
      target: '/features/fit-gpx-route-files',
    });
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
    expect(serviceConnectionsSection?.content).toContain('[FIT and GPX Route Files](/features/fit-gpx-route-files)');
    expect(serviceConnectionsSection?.content).toContain('[Sports Watch Benchmark](/features/sports-watch-benchmark)');
    expect(serviceConnectionsSection?.content).toContain('[Garmin to Suunto sync guide](/guides/sync-garmin-to-suunto)');
    expect(serviceConnectionsSection?.content).toContain('[COROS to Suunto sync guide](/guides/sync-coros-to-suunto)');
    expect(serviceConnectionsSection?.content).toContain('[centralized workout data guide](/guides/centralize-garmin-suunto-coros-workout-data)');
    expect(serviceConnectionsSection?.content).toContain('uploaded FIT/TCX/GPX/JSON/SML activity files');
    expect(serviceConnectionsSection?.content).toContain('reviewer workflows for device tests, YouTube videos, and blog posts');
    expect(serviceConnectionsSection?.content).toContain(`Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to ${USAGE_LIMITS.free} activities and ${ROUTE_USAGE_LIMITS.free} saved routes`);
    expect(serviceConnectionsSection?.content).toContain('automatic provider sync and higher limits require a paid plan');
    expect(serviceConnectionsSection?.content).not.toContain('source-file workflows, AI insights, and reviewer workflows');
    expect(serviceConnectionsSection?.content).toContain('[Garmin Integration](/integrations/garmin)');
    expect(serviceConnectionsSection?.content).toContain('[COROS Integration](/integrations/coros)');
    expect(serviceConnectionsSection?.content).toContain('/integrations/suunto');
    expect(serviceConnectionsSection?.content).toContain('[Policies -> Connected Services](/policies#connected-services-data)');
    expect(serviceConnectionsSection?.content).toContain('[Policies -> Garmin Data](/policies#garmin-data)');
    expect(serviceConnectionsSection?.content).toContain('[Policies -> Suunto Data](/policies#suunto-data)');
    expect(serviceConnectionsSection?.content).toContain('[Policies -> COROS Data](/policies#coros-data)');
    expect(serviceConnectionsSection?.content).toContain('[AI & Third-Party Processing](/policies#ai-and-third-party-processing)');
    expect(serviceConnectionsSection?.content).toContain('Suunto FIT activity uploads in Services show a per-file queue');
    expect(serviceConnectionsSection?.content).toContain('retry controls for failed files');
    expect(serviceConnectionsSection?.content).toContain('processed one file at a time with short pauses');
    expect(serviceConnectionsSection?.content).toContain('Saved FIT and GPX routes can be sent to Suunto from **Routes**');
    expect(serviceConnectionsSection?.content).toContain('row action or the selected-row bulk toolbar');
    expect(serviceConnectionsSection?.content).toContain('uses the saved Quantified Self route name as the route name sent to Suunto');
    expect(serviceConnectionsSection?.content).toContain('Bulk sends upload routes one at a time');
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
    expect(serviceConnectionsSection?.content).toContain('overlays available vitals');
    expect(serviceConnectionsSection?.content).toContain('sleep heart rate');
    expect(serviceConnectionsSection?.content).toContain('max SpO2');
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
      label: 'FIT and GPX Route Files',
      icon: 'route',
      kind: 'route',
      target: '/features/fit-gpx-route-files',
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
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Connected Service Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_CONNECTED_SERVICES_FRAGMENT,
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Garmin Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_GARMIN_DATA_FRAGMENT,
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Suunto Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_SUUNTO_DATA_FRAGMENT,
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'COROS Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_COROS_DATA_FRAGMENT,
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'AI & Processors',
      icon: 'shield',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_AI_AND_PROCESSORS_FRAGMENT,
    });
  });

  it('should expose provider-specific privacy links from the data-and-privacy section', () => {
    const dataAndPrivacySection = HELP_SECTIONS.find(section => section.id === 'data-and-privacy');

    expect(dataAndPrivacySection?.content).toContain('[Garmin Data](/policies#garmin-data)');
    expect(dataAndPrivacySection?.content).toContain('[Suunto Data](/policies#suunto-data)');
    expect(dataAndPrivacySection?.content).toContain('[COROS Data](/policies#coros-data)');
    expect(dataAndPrivacySection?.content).toContain('[AI & Third-Party Processing](/policies#ai-and-third-party-processing)');
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'Garmin Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_GARMIN_DATA_FRAGMENT,
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'Suunto Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_SUUNTO_DATA_FRAGMENT,
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'COROS Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_COROS_DATA_FRAGMENT,
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'AI & Processors',
      icon: 'shield',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_AI_AND_PROCESSORS_FRAGMENT,
    });
  });

  it('should explain public event and comparison sharing exposure', () => {
    const dataAndPrivacySection = HELP_SECTIONS.find(section => section.id === 'data-and-privacy');

    expect(dataAndPrivacySection?.content).toContain('Event and saved comparison sharing is manual');
    expect(dataAndPrivacySection?.content).toContain('every object stored under that event\'s source-file folder');
    expect(dataAndPrivacySection?.content).toContain('users/{uid}/events/{eventId}/...');
    expect(dataAndPrivacySection?.content).toContain('Use **Stop sharing**');
    expect(dataAndPrivacySection?.content).toContain('cannot generate or save new reports');
  });
});
