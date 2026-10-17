import { describe, expect, it } from 'vitest';
import { completeBenchmarkSourceWrite, preserveBenchmarkMetadataOnReparse } from './benchmark-preservation';

const identity = {
    activityIDRemap: new Map([['old-ref', 'new-ref'], ['old-test', 'new-test'], ['new-ref', 'new-ref'], ['new-test', 'new-test']]),
    currentActivityIDs: new Set(['new-ref', 'new-test']),
};
const report = {
    referenceId: 'old-ref', testId: 'old-test', timestamp: new Date(0),
    referenceName: 'Device A', testName: 'Device B', metrics: { gnss: null, streamMetrics: {} },
};

describe('benchmark reparse preservation', () => {
    it('preserves comparison metadata and remaps ordered report pairs without changing measurements', () => {
        const existing = {
            comparisonTitle: 'My comparison', toolSource: 'tools/compare', sourceFilesCount: 2,
            activitiesCount: 2, hasBenchmark: true, benchmarkStatus: 'draft', benchmarkLatestAt: new Date(0),
            benchmarkDevices: ['device a', 'device b'], benchmarkResults: { 'old-ref_old-test': report },
        };
        const result = preserveBenchmarkMetadataOnReparse({ name: 'Fresh parse' }, existing, identity);
        const { benchmarkResults: _reports, ...metadata } = existing;
        expect(result).toMatchObject({ ...metadata, name: 'Fresh parse' });
        expect(result.benchmarkResults).toEqual({ 'new-ref_new-test': {
            ...report, referenceId: 'new-ref', testId: 'new-test', requiresRegeneration: true, activityLinksResolved: true,
        } });
        expect(result.benchmarkSourceRevision).toBe(0);
        expect(result.benchmarkSourceWritePending).toBe(true);
        expect(existing.benchmarkResults['old-ref_old-test']).toBe(report);
        expect(report).not.toHaveProperty('requiresRegeneration');
    });

    it('keeps ambiguous participant references untouched and explicitly unresolved', () => {
        const result = preserveBenchmarkMetadataOnReparse({}, { benchmarkResults: { old: report } }, {
            activityIDRemap: new Map([['old-ref', 'new-ref']]), currentActivityIDs: identity.currentActivityIDs,
        });
        expect(result.benchmarkResults).toEqual({ old: { ...report, requiresRegeneration: true, activityLinksResolved: false } });
    });

    it('retains legacy single reports and already-current IDs', () => {
        const current = { ...report, referenceId: 'new-ref', testId: 'new-test' };
        expect(preserveBenchmarkMetadataOnReparse({}, { benchmarkResult: current }, identity).benchmarkResult)
            .toEqual({ ...current, requiresRegeneration: true, activityLinksResolved: true });
    });

    it('keeps both report entries if legacy keys alias the same pair', () => {
        const result = preserveBenchmarkMetadataOnReparse({}, { benchmarkResults: { one: report, two: report } }, identity);
        expect(Object.values(result.benchmarkResults as object)).toHaveLength(2);
    });

    it('preserves unusual unresolved map keys as data', () => {
        const reports = JSON.parse('{"__proto__":{"referenceId":"missing-ref","testId":"missing-test"}}');
        const result = preserveBenchmarkMetadataOnReparse({}, { benchmarkResults: reports }, identity);
        expect(Object.keys(result.benchmarkResults as object)).toEqual(['__proto__']);
        expect(Object.getPrototypeOf(result.benchmarkResults)).toBeNull();
    });

    it('guards a first benchmark generation on a regular workout during reparse', () => {
        expect(preserveBenchmarkMetadataOnReparse({ name: 'Fresh parse' }, { name: 'Edited' }, identity))
            .toEqual({ name: 'Fresh parse', benchmarkSourceRevision: 0, benchmarkSourceWritePending: true });
    });

    it('retains the source revision until completion even with no saved reports', () => {
        expect(preserveBenchmarkMetadataOnReparse({}, { mergeType: 'benchmark', benchmarkSourceRevision: 4 }, identity))
            .toMatchObject({ benchmarkSourceRevision: 4, benchmarkSourceWritePending: true });
    });

    it.each([undefined, 0, 4])('publishes the next completed revision for %s', revision => {
        expect(completeBenchmarkSourceWrite({ benchmarkSourceRevision: revision, benchmarkSourceWritePending: true }))
            .toEqual({ benchmarkSourceRevision: (revision ?? 0) + 1, benchmarkSourceWritePending: false });
    });

    it('does not advance an already completed generation on an ambiguous commit retry', () => {
        expect(completeBenchmarkSourceWrite({ benchmarkSourceRevision: 5, benchmarkSourceWritePending: false })).toEqual({});
    });
});
