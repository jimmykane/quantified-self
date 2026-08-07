import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAssistantEvidence,
  buildAssistantEvidenceList,
} from './evidence';
import type { AssistantMcpToolDefinition } from './mcp-session';

const evidenceTools = [
  {
    name: 'list_activity_types',
    title: 'List activity types',
    description: 'List canonical activity types.',
    inputSchema: { type: 'object' },
  },
  {
    name: 'rank_activities_by_metric',
    title: 'Rank activities by metric',
    description: 'Rank matching activities.',
    inputSchema: { type: 'object' },
  },
] satisfies AssistantMcpToolDefinition[];

describe('Assistant evidence', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds bounded display facts and safe app links from validated MCP output', () => {
    const evidence = buildAssistantEvidence({
      name: 'query_activities',
      title: 'Query activities',
    }, {
      activities: [{
        activityRef: 'opaque-ref',
        activityType: 'Running',
        startTimeMs: Date.parse('2026-08-01T06:00:00.000Z'),
        appUrl: 'https://quantified-self.io/user/u/event/e',
        stats: {
          durationSeconds: 3_725,
          averageHeartRateBpm: 142.4,
        },
        sourceKey: 'must-not-leak',
        provider: 'must-not-leak',
        latitudeDegrees: 39.665,
        lat: 39.666,
        lng: 20.854,
        bbox: [20.8, 39.6, 20.9, 39.7],
        center: [20.853, 39.665],
        startPosition: {
          longitudeDegrees: 20.853,
        },
      }],
      nextCursor: 'must-not-leak',
    });

    expect(evidence.summary).toBe('1 activities returned by Query activities.');
    expect(evidence.facts).toEqual([
      { label: 'Activity Type', value: 'Running' },
      { label: 'Start Time', value: '2026-08-01T06:00:00.000Z' },
      { label: 'Duration', value: '1h 2m' },
      { label: 'Average Heart Rate Bpm', value: '142.4' },
    ]);
    expect(evidence.links).toEqual([{
      label: 'Open in Quantified Self',
      url: 'https://quantified-self.io/user/u/event/e',
    }]);
    expect(JSON.stringify(evidence)).not.toContain('opaque-ref');
    expect(JSON.stringify(evidence)).not.toContain('must-not-leak');
    expect(JSON.stringify(evidence)).not.toMatch(
      /Latitude|Longitude|Position|Bbox|Center|39\.66|20\.85/,
    );
  });

  it('formats top-level health facts but rejects external links', () => {
    const evidence = buildAssistantEvidence({
      name: 'get_daily_report',
      title: 'Get daily report',
    }, {
      localDate: '2026-08-03',
      sleep: {
        startTimeMs: Date.parse('2026-08-03T20:26:00.000Z'),
        endTimeMs: Date.parse('2026-08-04T06:15:00.000Z'),
        durationSeconds: 29_100,
        inBedDurationSeconds: 35_340,
      },
      appUrl: 'https://attacker.example/redirect',
    });

    expect(evidence.facts).toEqual([
      { label: 'Local Date', value: '2026-08-03' },
      { label: 'Start Time', value: '2026-08-03T20:26:00.000Z' },
      { label: 'End Time', value: '2026-08-04T06:15:00.000Z' },
      { label: 'Duration', value: '8h 5m' },
      { label: 'In Bed Duration', value: '9h 49m' },
    ]);
    expect(evidence.links).toEqual([]);
  });

  it('shows the exact winning activity date and value for metric rankings', () => {
    const evidence = buildAssistantEvidence({
      name: 'rank_activities_by_metric',
      title: 'Rank activities by metric',
    }, {
      activities: [{
        rank: 1,
        activityRef: 'opaque-ranking-ref',
        startTime: '2026-07-31T07:50:22.000Z',
        activityType: 'Downhill Cycling',
        value: 10.411559104919434,
      }],
      metric: {
        type: 'Maximum Jump Distance',
        displayType: 'Maximum Jump Distance',
        unit: 'm',
        unitSystem: 'metric',
      },
      order: 'highest',
      scannedActivityCount: 795,
      matchedActivityCount: 137,
    });

    expect(evidence.facts).toEqual([
      { label: 'Activity Type', value: 'Downhill Cycling' },
      { label: 'Value', value: '10.41 m' },
      { label: 'Start Time', value: '2026-07-31T07:50:22.000Z' },
      { label: 'Rank', value: '1' },
      { label: 'Scanned Activity Count', value: '795' },
    ]);
    expect(JSON.stringify(evidence)).not.toContain('opaque-ranking-ref');
  });

  it('omits catalog discovery when a substantive result grounds the answer', () => {
    const evidence = buildAssistantEvidenceList(evidenceTools, [
      {
        name: 'list_activity_types',
        structuredContent: {
          activityTypeCount: 130,
          activityTypes: [{
            activityType: 'Adventure Racing',
            activityGroup: 'unspecified_group',
            indoor: false,
          }],
        },
      },
      {
        name: 'rank_activities_by_metric',
        structuredContent: {
          activities: [{
            rank: 1,
            startTime: '2026-07-31T07:50:22.000Z',
            activityType: 'Downhill Cycling',
            value: 10.41,
          }],
          metric: { unit: 'm' },
          scannedActivityCount: 795,
        },
      },
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      toolName: 'rank_activities_by_metric',
      facts: expect.arrayContaining([
        { label: 'Value', value: '10.41 m' },
      ]),
    });
  });

  it('retains standalone discovery evidence with human-readable enum values', () => {
    const [evidence] = buildAssistantEvidenceList(evidenceTools, [{
      name: 'list_activity_types',
      structuredContent: {
        activityTypeCount: 130,
        activityTypes: [{
          activityType: 'Adventure Racing',
          activityGroup: 'unspecified_group',
          indoor: false,
        }],
      },
    }]);

    expect(evidence.facts).toEqual(expect.arrayContaining([
      { label: 'Activity Group', value: 'Unspecified' },
    ]));
  });

  it('shows route-summary evidence without leaking references or geography', () => {
    const evidence = buildAssistantEvidence({
      name: 'list_routes',
      title: 'List saved routes',
    }, {
      routes: [{
        routeRef: 'opaque-route-ref',
        appUrl: 'https://quantified-self.io/user/u/route/r',
        name: 'Lunch loop',
        activityTypes: ['Cycling'],
        locationRedacted: true,
        bounds: {
          minLatitudeDegrees: 39.65,
          minLongitudeDegrees: 20.84,
        },
        provider: 'must-not-leak',
      }],
    });

    expect(evidence.summary).toBe('1 routes returned by List saved routes.');
    expect(evidence.facts).toEqual(expect.arrayContaining([
      { label: 'Name', value: 'Lunch loop' },
    ]));
    expect(evidence.links).toEqual([{
      label: 'Open in Quantified Self',
      url: 'https://quantified-self.io/user/u/route/r',
    }]);
    expect(JSON.stringify(evidence)).not.toContain('opaque-route-ref');
    expect(JSON.stringify(evidence)).not.toContain('must-not-leak');
    expect(JSON.stringify(evidence)).not.toMatch(/Latitude|Longitude|39\.65|20\.84/);
  });

  it('keeps opted-in activity and jump coordinates out of deterministic evidence', () => {
    const evidence = buildAssistantEvidence({
      name: 'list_activity_jumps',
      title: 'List activity jumps',
    }, {
      jumps: [{
        distanceMeters: 10.41,
        heightMeters: 1.2,
        latitudeDegrees: 39.665,
        longitudeDegrees: 20.853,
        position: {
          latitudeDegrees: 39.665,
          longitudeDegrees: 20.853,
        },
      }],
    });

    expect(JSON.stringify(evidence)).toContain('10.41');
    expect(JSON.stringify(evidence)).not.toMatch(/Latitude|Longitude|39\.665|20\.853/);
  });

  it('does not use denied provenance counts in its fallback summary', () => {
    const evidence = buildAssistantEvidence({
      name: 'get_training_metric',
      title: 'Get a Training metric',
    }, {
      sourceCount: 9,
    });

    expect(evidence.summary).toBe('Grounded in Get a Training metric.');
    expect(evidence.facts).toEqual([]);
  });

  it('does not discover app links nested under denied provenance fields', () => {
    const evidence = buildAssistantEvidence({
      name: 'get_training_metric',
      title: 'Get a Training metric',
    }, {
      provider: {
        appUrl: 'https://quantified-self.io/user/private/event/private',
      },
    });

    expect(evidence.links).toEqual([]);
  });

  it('rejects allowlisted hosts on unexpected ports or with credentials', () => {
    for (const appUrl of [
      'https://quantified-self.io:444/user/u/event/e',
      'https://user:password@quantified-self.io/user/u/event/e',
    ]) {
      expect(buildAssistantEvidence({
        name: 'query_activities',
        title: 'Query activities',
      }, { appUrl }).links).toEqual([]);
    }
  });

  it('accepts an explicit loopback app link only in the Functions emulator', () => {
    const appUrl = 'https://localhost:4200/user/u/event/e';
    expect(buildAssistantEvidence({
      name: 'query_activities',
      title: 'Query activities',
    }, { appUrl }).links).toEqual([]);

    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    expect(buildAssistantEvidence({
      name: 'query_activities',
      title: 'Query activities',
    }, { appUrl }).links).toEqual([{
      label: 'Open in Quantified Self',
      url: appUrl,
    }]);
  });
});
