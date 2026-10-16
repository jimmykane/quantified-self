import { describe, expect, it, vi } from 'vitest';
import { shouldPreserveParsedDistance } from './regeneration-distance';

describe('fresh parser distance precedence', () => {
    it.each([undefined, null, 0, -1, NaN, Infinity, -Infinity, '100'])(
        'allows derivation for a missing, zero or invalid total: %s', value => {
            expect(shouldPreserveParsedDistance({}, value)).toBe(false);
        });

    it.each([0.01, 1000, 15000, 21100, 100208])('preserves a finite positive parsed total: %s', distance => {
        // Partial, reset, stalled, or apparently complete measurements do not
        // establish that overwriting a source-selected total is a correction.
        const source = { getStreamData: vi.fn(() => { throw new Error('Do not infer source precedence from streams'); }) };
        expect(shouldPreserveParsedDistance(source, distance)).toBe(true);
        expect(source.getStreamData).not.toHaveBeenCalled();
    });
});
