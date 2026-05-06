import { describe, expect, it } from 'vitest';

import {
    classifyEventForTrainingMetrics,
    isBenchmarkEventForTrainingMetrics,
} from '../../../shared/event-classification';

describe('event training metrics classifier', () => {
    it('classifies normal events as standard', () => {
        expect(classifyEventForTrainingMetrics({})).toBe('standard');
        expect(classifyEventForTrainingMetrics({ isMerge: false })).toBe('standard');
        expect(classifyEventForTrainingMetrics(null)).toBe('standard');
    });

    it('classifies multi merges as standard', () => {
        expect(classifyEventForTrainingMetrics({ mergeType: 'multi', isMerge: false })).toBe('standard');
        expect(classifyEventForTrainingMetrics({ mergeType: ' multi ' })).toBe('standard');
    });

    it('classifies benchmark merges as benchmark', () => {
        expect(classifyEventForTrainingMetrics({ mergeType: 'benchmark', isMerge: false })).toBe('benchmark');
        expect(classifyEventForTrainingMetrics({ mergeType: ' Benchmark ' })).toBe('benchmark');
        expect(isBenchmarkEventForTrainingMetrics({ mergeType: 'benchmark' })).toBe(true);
    });

    it('treats isMerge=true as benchmark fallback', () => {
        expect(classifyEventForTrainingMetrics({ isMerge: true })).toBe('benchmark');
        expect(classifyEventForTrainingMetrics({ isMerge: true, mergeType: 'multi' })).toBe('benchmark');
    });

    it('treats malformed fields as standard', () => {
        expect(classifyEventForTrainingMetrics({ mergeType: ['benchmark'] })).toBe('standard');
        expect(classifyEventForTrainingMetrics({ isMerge: 'true' })).toBe('standard');
        expect(isBenchmarkEventForTrainingMetrics({ mergeType: 42, isMerge: false })).toBe(false);
    });
});
