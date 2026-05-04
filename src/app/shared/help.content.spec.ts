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

    expect(gettingStartedSection?.content).toContain('Recovery Left Now');
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
    expect(gettingStartedSection?.content).toContain('removing it prevents future automatic Sleep tile adds');
    expect(gettingStartedSection?.content).toContain('default curated chart set');
    expect(gettingStartedSection?.content).toContain('KPI row set automatically once');
    expect(gettingStartedSection?.content).toContain('removing an auto-added curated chart or KPI prevents that chart from being suggested again');
  });

  it('should document that distance values follow unit preferences across the app', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Distance values in dashboards, event charts, activity chips, and CSV exports');
    expect(gettingStartedSection?.content).toContain('dashboard unit prompt');
    expect(gettingStartedSection?.content).toContain('Advanced settings');
    expect(gettingStartedSection?.content).toContain('kilometers or miles');
    expect(gettingStartedSection?.content).toContain('Settings -> Units');
    expect(gettingStartedSection?.content).toContain('jump distances display in feet when miles are selected');
  });

  it('should document non-merged event heart-rate zone line coloring', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('provider heart-rate zone boundaries');
    expect(gettingStartedSection?.content).toContain('non-merged events');
    expect(gettingStartedSection?.content).toContain('**Heart Rate** chart colors the line');
    expect(gettingStartedSection?.content).not.toContain('lightly tints the chart grid by zone');
  });

  it('should document the dashboard form tile CTL/ATL/TSB behavior', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Form tile (CTL / ATL / TSB)');
    expect(gettingStartedSection?.content).toContain('Training Stress Score');
    expect(gettingStartedSection?.content).toContain('Power Training Stress Score');
    expect(gettingStartedSection?.content).toContain('Form (TSB)');
    expect(gettingStartedSection?.content).toContain('same-day readiness');
    expect(gettingStartedSection?.content).toContain('full history');
    expect(gettingStartedSection?.content).toContain('W / M / Y');
    expect(gettingStartedSection?.content).toContain('continue to **today** with zero-load decay');
    expect(gettingStartedSection?.content).toContain('does not use slider or reload/reset toolbar controls');
    expect(gettingStartedSection?.content).toContain('Latest TSS');
    expect(gettingStartedSection?.content).toContain('weekly');
    expect(gettingStartedSection?.content).toContain('asynchronously');
    expect(gettingStartedSection?.content).toContain('status notice');
  });

  it('should document new derived KPI rows and curated charts', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Freshness Forecast');
    expect(gettingStartedSection?.content).toContain('Intensity Distribution');
    expect(gettingStartedSection?.content).toContain('Efficiency Trend');
    expect(gettingStartedSection?.content).not.toContain('**Sleep** shows connected-source sleep duration');
    expect(gettingStartedSection?.content).toContain('ACWR');
    expect(gettingStartedSection?.content).toContain('Ramp Rate');
    expect(gettingStartedSection?.content).toContain('Monotony / Strain');
    expect(gettingStartedSection?.content).toContain('Form Now');
    expect(gettingStartedSection?.content).toContain('Fitness (CTL)');
    expect(gettingStartedSection?.content).toContain('Fatigue (ATL)');
    expect(gettingStartedSection?.content).toContain('Form +7d');
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

    expect(serviceConnectionsSection?.content).toContain('Garmin -> Suunto activity sync is route-based');
    expect(serviceConnectionsSection?.content).toContain('ACTIVITY_EXPORT');
    expect(serviceConnectionsSection?.content).toContain('Manual catch-up is available in Garmin Services');
    expect(serviceConnectionsSection?.content).toContain('convenience tool for queuing a period on demand');
    expect(serviceConnectionsSection?.content).toContain('stored original files already attached to existing Quantified Self events');
    expect(serviceConnectionsSection?.content).toContain('can run even when the Garmin -> Suunto auto-sync toggle is off');
    expect(serviceConnectionsSection?.content).toContain('Disconnecting Garmin, COROS, or Suunto automatically disables related route auto-sync settings');
    expect(serviceConnectionsSection?.content).toContain('Sleep sync is server-owned health data');
    expect(serviceConnectionsSection?.content).toContain('14d, 30d, 90d, and 1y range control');
    expect(serviceConnectionsSection?.content).toContain('independent from dashboard event filters');
    expect(serviceConnectionsSection?.content).toContain('overlays recorded sleep HRV with an average HRV reference line');
    expect(serviceConnectionsSection?.content).toContain('Backfill Sleep History');
    expect(serviceConnectionsSection?.content).toContain('Jan 1, 2016');
    expect(serviceConnectionsSection?.content).toContain('7-day sleep backfill cooldown');
    expect(serviceConnectionsSection?.content).toContain('COROS -> Suunto activity sync is route-based');
    expect(serviceConnectionsSection?.content).toContain('enable the route toggle in COROS Services');
    expect(serviceConnectionsSection?.content).toContain('Automatic sync runs only for newly imported COROS activities');
    expect(serviceConnectionsSection?.content).toContain('Manual catch-up is available in COROS Services');
    expect(serviceConnectionsSection?.content).toContain('can run even when the COROS -> Suunto auto-sync toggle is off');
  });
});
