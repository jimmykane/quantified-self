import { describe, expect, it } from 'vitest';

import {
    classifyEventForStats,
    EVENT_STATS_KIND,
    EVENT_STATS_SCHEMA_VERSION,
    hasExactEventStats,
    normalizeEventStatsCounts,
} from '../../../shared/event-stats';

describe('event stats classifier', () => {
    it('classifies normal events as standard', () => {
        expect(classifyEventForStats({})).toBe('standard');
        expect(classifyEventForStats({ isMerge: false })).toBe('standard');
    });

    it('classifies multi merges as standard', () => {
        expect(classifyEventForStats({ mergeType: 'multi', isMerge: false })).toBe('standard');
        expect(classifyEventForStats({ mergeType: ' multi ' })).toBe('standard');
    });

    it('classifies benchmark merges as benchmark', () => {
        expect(classifyEventForStats({ mergeType: 'benchmark', isMerge: false })).toBe('benchmark');
        expect(classifyEventForStats({ mergeType: ' Benchmark ' })).toBe('benchmark');
    });

    it('treats isMerge=true as benchmark fallback', () => {
        expect(classifyEventForStats({ isMerge: true })).toBe('benchmark');
        expect(classifyEventForStats({ isMerge: true, mergeType: 'multi' })).toBe('benchmark');
    });

    it('normalizes malformed stats counts to non-negative integers', () => {
        expect(normalizeEventStatsCounts({
            total: 3.9,
            standard: -4,
            benchmark: '2',
        })).toEqual({
            total: 3,
            standard: 0,
            benchmark: 0,
        });
    });

    it('requires backfilledAt before stats are considered exact', () => {
        expect(hasExactEventStats({ total: 1 })).toBe(false);
        expect(hasExactEventStats({
            kind: EVENT_STATS_KIND,
            schemaVersion: EVENT_STATS_SCHEMA_VERSION,
            total: 1,
            backfilledAt: 'now',
        })).toBe(true);
        expect(hasExactEventStats({
            kind: 'other',
            schemaVersion: EVENT_STATS_SCHEMA_VERSION,
            total: 1,
            backfilledAt: 'now',
        })).toBe(false);
    });
});
