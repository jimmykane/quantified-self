import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unmock the global mock from test-setup.ts
vi.unmock('./request-helper');

import requestHelper, { getBinaryResponse, ResponseBodyTooLargeError } from './request-helper';

describe('request-helper', () => {
    beforeEach(() => {
        vi.useRealTimers();
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

    it('should abort a request when its timeout expires', async () => {
        vi.useFakeTimers();
        (global.fetch as any).mockImplementation((_url: string, options: { signal: AbortSignal }) => (
            new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => {
                    const error = new Error('The operation was aborted.');
                    error.name = 'AbortError';
                    reject(error);
                }, { once: true });
            })
        ));

        const request = requestHelper.get({ url: 'https://example.com', timeout: 1_000 });
        const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
        await vi.advanceTimersByTimeAsync(1_000);
        await rejection;
    });

    it('rejects a decoded success body that exceeds the configured byte limit', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response('decoded payload', {
            headers: { 'content-length': '1' },
        }));

        await expect(requestHelper.get({
            url: 'https://example.com',
            maxResponseBytes: 8,
        })).rejects.toBeInstanceOf(ResponseBodyTooLargeError);
    });

    it('returns a response that stays within the configured byte limit', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response('bounded payload'));

        await expect(requestHelper.get({
            url: 'https://example.com',
            maxResponseBytes: 15,
        })).resolves.toBe('bounded payload');
    });

    it('returns binary response metadata without requiring a byte limit or exposing unrelated headers', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response(Buffer.from([0x01, 0x02, 0x03]), {
            headers: {
                'content-length': '3',
                'content-type': 'application/octet-stream',
                'set-cookie': 'secret=value',
            },
        }));

        await expect(getBinaryResponse({
            url: 'https://example.com/file.fit',
        })).resolves.toEqual({
            body: Buffer.from([0x01, 0x02, 0x03]),
            statusCode: 200,
            contentType: 'application/octet-stream',
            contentLength: 3,
        });
    });

    it('bounds error bodies before buffering them', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response('oversized provider error', {
            status: 503,
        }));

        await expect(requestHelper.get({
            url: 'https://example.com',
            maxResponseBytes: 8,
        })).rejects.toMatchObject({
            name: 'ResponseBodyTooLargeError',
            maxResponseBytes: 8,
        });
    });
});
