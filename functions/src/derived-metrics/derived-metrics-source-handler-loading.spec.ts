import { describe, expect, it, vi } from 'vitest';

const lazy = vi.hoisted(() => ({ loaded: vi.fn(), metadata: vi.fn() }));
vi.mock('firebase-admin', () => ({ firestore: () => ({ doc: () => ({ get: lazy.metadata }) }) }));
vi.mock('../../../shared/derived-metrics', () => { lazy.loaded(); return {}; });
vi.mock('../training-load/training-load-cache', () => { lazy.loaded(); return {}; });
vi.mock('../shared/cloud-tasks', () => { lazy.loaded(); return {}; });
import { handleDerivedMetricsSourceWrite } from './derived-metrics-source-handler';
type SourceEvent = Parameters<typeof handleDerivedMetricsSourceWrite>[0];

const write = (data: unknown): SourceEvent => ({ params: { uid: 'owner', eventId: 'workout', activityId: 'leg' }, data: {
    before: { exists: false }, after: { exists: true, data: () => data, updateTime: { seconds: 2, nanoseconds: 3 } },
} }) as unknown as SourceEvent;

describe('lightweight source coordination', () => {
    it.each(['event', 'activity'] as const)('skips coordinated %s deliveries without loading calculations, cache or queue code', async source => {
        lazy.metadata.mockResolvedValueOnce({ data: () => ({ sourceWritePending: true }) })
            .mockResolvedValueOnce({ data: () => ({ sourceWriteTimes: { event: '2:3', 'activity:leg': '2:3' } }) });
        await handleDerivedMetricsSourceWrite(write({ eventID: 'workout' }), source);
        await handleDerivedMetricsSourceWrite(write({ eventID: 'workout' }), source);
        expect(lazy.loaded).not.toHaveBeenCalled();
    });

    it('skips irrelevant Health changes without loading calculations, cache or queue code', async () => {
        await handleDerivedMetricsSourceWrite(write({ metricIds: ['steps'] }), 'health');
        await handleDerivedMetricsSourceWrite(write({ metricIds: ['heart_rate'],
            source: { provider: 'GarminAPI', sourceRecordType: 'garmin_daily' }, sampleChunkIds: [] }), 'health');
        expect(lazy.loaded).not.toHaveBeenCalled();
    });
});
