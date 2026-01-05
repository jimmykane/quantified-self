import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unmock the global mock from test-setup.ts
vi.unmock('./request-helper');

import requestHelper from './request-helper';

describe('request-helper', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Mock global fetch
        vi.stubGlobal('fetch', vi.fn());
    });

    it('should perform GET request with default options', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            text: () => Promise.resolve('ok text')
        });

        const result = await requestHelper.get('https://example.com');

        expect(global.fetch).toHaveBeenCalledWith('https://example.com', expect.objectContaining({
            method: 'GET'
        }));
        expect(result).toBe('ok text');
    });

    it('should correctly handle JSON response if json: true is set', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ success: true })
        });

        const result = await requestHelper.post('https://example.com', { json: true, body: { data: 123 } });

        expect(result).toEqual({ success: true });
        expect(global.fetch).toHaveBeenCalledWith('https://example.com', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ data: 123 }),
            headers: expect.objectContaining({ 'Content-Type': 'application/json' })
        }));
    });

    it('should throw StatusCodeError on non-ok response', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            text: () => Promise.resolve('not found error')
        });

        try {
            await requestHelper.get('https://example.com');
            expect.fail('Should have thrown');
        } catch (e: any) {
            expect(e.message).toContain('StatusCodeError: 404');
            expect(e.statusCode).toBe(404);
            expect(e.error).toBe('not found error');
        }
    });

    it('should handle bearer auth shortcut', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            text: () => Promise.resolve('')
        });

        await requestHelper.get({
            url: 'https://example.com',
            auth: { bearer: 'myToken' }
        });

        expect(global.fetch).toHaveBeenCalledWith('https://example.com', expect.objectContaining({
            headers: expect.objectContaining({
                'Authorization': 'Bearer myToken'
            })
        }));
    });

    it('should handle form data', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            text: () => Promise.resolve('')
        });

        await requestHelper.post('https://example.com', {
            form: { key: 'value', foo: 'bar' }
        });

        const call = (global.fetch as any).mock.calls[0];
        expect(call[1].body).toBeInstanceOf(URLSearchParams);
        expect(call[1].body.get('key')).toBe('value');
    });
});
