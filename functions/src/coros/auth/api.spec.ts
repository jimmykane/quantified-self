import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMocks = {
    get: vi.fn(),
    post: vi.fn(),
};

vi.mock('../../request-helper', () => ({
    get: (...args: any[]) => requestMocks.get(...args),
    post: (...args: any[]) => requestMocks.post(...args),
}));

import { getCOROSUserId } from './api';

describe('COROS auth API helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        requestMocks.get.mockResolvedValue({ data: { openId: 'open-id-123' } });
    });

    it('uses production base url by default', async () => {
        const openId = await getCOROSUserId('access-token-1');

        expect(openId).toBe('open-id-123');
        expect(requestMocks.get).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://open.coros.com/v2/user',
            headers: expect.objectContaining({
                Authorization: 'Bearer access-token-1',
            }),
        }));
    });

    it('uses provided base url for user lookup', async () => {
        const openId = await getCOROSUserId('access-token-2', 'https://opentest.coros.com/');

        expect(openId).toBe('open-id-123');
        expect(requestMocks.get).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://opentest.coros.com/v2/user',
        }));
    });
});
