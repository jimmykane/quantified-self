import { describe, expect, it } from 'vitest';
import {
    CLOUD_TASK_RETRY_CONFIG,
    getCloudTaskRetryBackoffSeconds,
    MAX_RETRY_COUNT,
    PROVIDER_CLOUD_TASK_RETRY_CONFIG,
    PROVIDER_MAX_RETRY_COUNT,
    REPARSE_HEAVY_TASK_RETRY_CONFIG,
} from './queue-config';

describe('queue retry policies', () => {
    it('aligns recorded provider application and task budgets at 20 attempts', () => {
        expect(PROVIDER_MAX_RETRY_COUNT).toBe(20);
        expect(PROVIDER_CLOUD_TASK_RETRY_CONFIG).toEqual({
            ...CLOUD_TASK_RETRY_CONFIG,
            maxAttempts: PROVIDER_MAX_RETRY_COUNT,
        });
    });

    it('keeps default, scheduled Training and heavy reparse budgets at 10', () => {
        expect(MAX_RETRY_COUNT).toBe(10);
        expect(CLOUD_TASK_RETRY_CONFIG).toEqual({
            maxAttempts: 10,
            minBackoffSeconds: 900,
            maxBackoffSeconds: 14400,
            maxDoublings: 4,
        });
        expect(REPARSE_HEAVY_TASK_RETRY_CONFIG).toEqual(CLOUD_TASK_RETRY_CONFIG);
    });

    it('preserves the retry cadence and four-hour cap through the larger budget', () => {
        expect(Array.from({ length: 20 }, (_, index) => getCloudTaskRetryBackoffSeconds(index + 1)))
            .toEqual([900, 1800, 3600, 7200, ...Array(16).fill(14400)]);
    });
});
