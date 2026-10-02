import { describe, expect, it } from 'vitest';
import config from '../vitest.config';

describe('Functions test runner configuration', () => {
    it('bounds worker concurrency without sharing a process between files', () => {
        expect(config.test?.pool).toBe('forks');
        expect(config.test?.maxWorkers).toBe(2);
        expect(config.test?.minWorkers).toBe(1);
        expect(config.test?.isolate).not.toBe(false);
        expect(config.test?.poolOptions?.forks?.isolate).not.toBe(false);
        expect(config.test?.poolOptions?.forks?.singleFork).not.toBe(true);
    });

    it('keeps unhandled runner errors fatal', () => {
        expect(config.test?.dangerouslyIgnoreUnhandledErrors).not.toBe(true);
    });
});
