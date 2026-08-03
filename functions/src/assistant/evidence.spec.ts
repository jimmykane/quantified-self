import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAssistantEvidence } from './evidence';

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
      { label: 'Start Time Ms', value: '2026-08-01T06:00:00.000Z' },
      { label: 'Duration Seconds', value: '1h 2m' },
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
        durationSeconds: 29_100,
        averageHeartRateBpm: 51.24,
      },
      appUrl: 'https://attacker.example/redirect',
    });

    expect(evidence.facts).toEqual([
      { label: 'Local Date', value: '2026-08-03' },
      { label: 'Duration Seconds', value: '8h 5m' },
      { label: 'Average Heart Rate Bpm', value: '51.24' },
    ]);
    expect(evidence.links).toEqual([]);
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
