import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.mock('node-fetch', () => ({ default: (...args: unknown[]) => fetchMock(...args) }));

import { downloadWahooFITFile, UnsafeWahooFileUrlError } from './file-download';

function fitPayload(size = 16): Buffer {
  const payload = Buffer.alloc(size);
  payload[0] = 12;
  payload.write('.FIT', 8, 'ascii');
  return payload;
}

function response(status: number, payload: Buffer | null, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] || null },
    body: payload ? Readable.from([payload]) : null,
  };
}

describe('downloadWahooFITFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WAHOOAPI_CLIENT_ID = 'id';
    process.env.WAHOOAPI_CLIENT_SECRET = 'secret';
    process.env.WAHOOAPI_WEBHOOK_TOKEN = 'token';
    process.env.WAHOOAPI_ALLOWED_FILE_HOSTS = 'cdn.wahooligan.com';
  });

  it('downloads a bounded FIT file from the allowlisted CDN', async () => {
    const payload = fitPayload();
    fetchMock.mockResolvedValue(response(200, payload, { 'content-length': `${payload.length}` }));
    await expect(downloadWahooFITFile('https://cdn.wahooligan.com/file.fit')).resolves.toEqual(payload);
  });

  it('rejects non-HTTPS and non-allowlisted URLs before fetching', async () => {
    await expect(downloadWahooFITFile('http://cdn.wahooligan.com/file.fit')).rejects.toBeInstanceOf(UnsafeWahooFileUrlError);
    await expect(downloadWahooFITFile('https://example.com/file.fit')).rejects.toBeInstanceOf(UnsafeWahooFileUrlError);
    await expect(downloadWahooFITFile('https://127.0.0.1/file.fit')).rejects.toBeInstanceOf(UnsafeWahooFileUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks redirect destinations against the allowlist', async () => {
    fetchMock.mockResolvedValue(response(302, null, { location: 'https://attacker.example/file.fit' }));
    await expect(downloadWahooFITFile('https://cdn.wahooligan.com/file.fit')).rejects.toBeInstanceOf(UnsafeWahooFileUrlError);
  });

  it('rejects oversized and malformed payloads', async () => {
    fetchMock.mockResolvedValueOnce(response(200, fitPayload(), { 'content-length': `${20 * 1024 * 1024 + 1}` }));
    await expect(downloadWahooFITFile('https://cdn.wahooligan.com/large.fit')).rejects.toThrow('20 MB');
    fetchMock.mockResolvedValueOnce(response(200, Buffer.from('not-fit')));
    await expect(downloadWahooFITFile('https://cdn.wahooligan.com/bad.fit')).rejects.toThrow('valid FIT');
  });

  it('does not expose a signed FIT URL when the HTTP client fails', async () => {
    const signedUrl = 'https://cdn.wahooligan.com/file.fit?signature=secret-value';
    fetchMock.mockRejectedValue(new Error(`request to ${signedUrl} failed`));

    await expect(downloadWahooFITFile(signedUrl)).rejects.toThrow('Wahoo FIT download request failed.');
    await expect(downloadWahooFITFile(signedUrl)).rejects.not.toThrow('secret-value');
  });
});
