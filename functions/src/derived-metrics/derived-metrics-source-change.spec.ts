import { describe, expect, it } from 'vitest';
import { hasDerivedMetricSourceChange } from './derived-metrics-source-change';
import { SLEEP_SPORTS_LIB_METRIC_FIELDS } from '../../../shared/sleep';

describe('derived source invalidation', () => {
    it.each(['event', 'activity', 'sleep', 'health'] as const)('ignores metadata-only %s updates and preserves create/delete', source => {
        const data = { startDate: 1, stats: { TSS: 50 }, metricIds: ['heart_rate_variability'] };
        expect(hasDerivedMetricSourceChange(source, data, { ...data, updatedAtMs: 2, processing: true })).toBe(false);
        expect(hasDerivedMetricSourceChange(source, undefined, data)).toBe(true);
        expect(hasDerivedMetricSourceChange(source, data, undefined)).toBe(true);
    });
    it.each(['stats', 'startDate', 'endDate', 'name', 'tags', 'benchmarkReviewTags', 'isMerge', 'mergeType', 'creator', 'serviceName', 'sourceServiceName'])('retains event %s invalidation', key => {
        expect(hasDerivedMetricSourceChange('event', {}, { [key]: 'changed' })).toBe(true);
    });
    it.each(['eventID', 'type', 'stats', 'swimLengths', 'startDate', 'creator'])('retains activity %s invalidation', key => {
        expect(hasDerivedMetricSourceChange('activity', {}, { [key]: 'changed' })).toBe(true);
    });
    it('invalidates load edits and explicit identity reset, but ignores revision-only bookkeeping', () => {
        const before = { revision: 1, controls: {}, excluded: false };
        expect(hasDerivedMetricSourceChange('training-load', before, { ...before, revision: 2, updatedAt: 100 })).toBe(false);
        for (const patch of [{ excluded: true }, { controls: { leg: { override: 0 } } }, { resetUnmatched: true }])
            expect(hasDerivedMetricSourceChange('training-load', before, { ...before, ...patch })).toBe(true);
    });
    it('compares nested canonical sleep fields and source identity', () => {
        expect(hasDerivedMetricSourceChange('sleep', {}, { sportsLibData: { metrics: { [SLEEP_SPORTS_LIB_METRIC_FIELDS.OvernightHrv]: 45 } } })).toBe(true);
        expect(hasDerivedMetricSourceChange('sleep', { source: { providerUserId: 'a' } }, { source: { providerUserId: 'b' } })).toBe(true);
        expect(hasDerivedMetricSourceChange('sleep', {}, { providerFields: { suunto: { timestamp: 'offset-changed' } } })).toBe(true);
        expect(hasDerivedMetricSourceChange('sleep', {}, {
            providerFields: { suunto: { SleepOnsetLatencyDuration: 480 } },
        })).toBe(true);
    });
    it('ignores Health watermarks but retains source, date and measurement changes', () => {
        const data = { source: { provider: 'SuuntoApp', maxObservedRevisionOrder: 1 } };
        expect(hasDerivedMetricSourceChange('health', data, { source: { ...data.source, maxObservedRevisionOrder: 2 } })).toBe(false);
        for (const update of [{ metrics: [{ value: 1 }] }, { calendarDate: '2026-09-01' }, { source: { accountKey: 'different' } }]) {
            expect(hasDerivedMetricSourceChange('health', data, update)).toBe(true);
        }
    });
    it('ignores object key order but preserves removed values', () => {
        expect(hasDerivedMetricSourceChange('event', { stats: { a: 1, b: 2 } }, { stats: { b: 2, a: 1 } })).toBe(false);
        expect(hasDerivedMetricSourceChange('event', { stats: { a: 1 } }, { stats: {} })).toBe(true);
    });
});
