import { describe, expect, it } from 'vitest';
import { buildAssistantEvidence } from './evidence';

describe('Assistant evidence', () => {
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
    expect(JSON.stringify(evidence)).not.toMatch(/Latitude|Longitude|39\.665|20\.853/);
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
});
