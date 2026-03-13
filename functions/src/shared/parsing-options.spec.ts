import { describe, expect, it, vi } from 'vitest';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
    const actual: any = await importOriginal();
    return actual;
});
import { createParsingOptions } from './parsing-options';

describe('createParsingOptions', () => {
    it('returns parser-compatible options with the expected defaults', () => {
        const options = createParsingOptions();
        expect(options).toEqual(expect.objectContaining({
            generateUnitStreams: false,
            deviceInfoMode: 'changes',
        }));
    });

    it('applies function defaults for queue parsing', () => {
        const options = createParsingOptions();
        expect(options.generateUnitStreams).toBe(false);
        expect(options.deviceInfoMode).toBe('changes');
    });

    it('keeps sports-lib defaults for unrelated options', () => {
        const options = createParsingOptions();
        expect(options.maxActivityDurationDays).toBe(14);
        expect(options.streams).toBeDefined();
    });

    it('allows overriding generateUnitStreams', () => {
        const options = createParsingOptions({ generateUnitStreams: true });
        expect(options.generateUnitStreams).toBe(true);
        expect(options.deviceInfoMode).toBe('changes');
    });

    it('allows overriding deviceInfoMode', () => {
        const options = createParsingOptions({ deviceInfoMode: 'raw' });
        expect(options.deviceInfoMode).toBe('raw');
        expect(options.generateUnitStreams).toBe(false);
    });

    it('returns a new instance per invocation', () => {
        const first = createParsingOptions();
        const second = createParsingOptions();
        expect(first).not.toBe(second);
    });
});
