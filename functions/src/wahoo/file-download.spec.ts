import { Readable } from 'stream';
import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, infoMock, warnMock, beforeRequestMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(), infoMock: vi.fn(), warnMock: vi.fn(), beforeRequestMock: vi.fn(),
}));
vi.mock('node-fetch', () => ({ default: (...args: unknown[]) => fetchMock(...args) }));
vi.mock('firebase-functions/logger', () => ({
  info: (...args: unknown[]) => infoMock(...args),
  warn: (...args: unknown[]) => warnMock(...args),
}));
vi.mock('../connection-history/context', () => ({
  currentHistoryExecution: () => ({ beforeRequest: beforeRequestMock }),
}));

import { downloadWahooFITFile, UnsafeWahooFileUrlError } from './file-download';
import { WAHOO_FIT_DOWNLOAD_TIMEOUT_MS } from './constants';

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
    vi.useRealTimers();
    vi.resetAllMocks();
    process.env.WAHOOAPI_CLIENT_ID = 'id';
    process.env.WAHOOAPI_CLIENT_SECRET = 'secret';
    process.env.WAHOOAPI_WEBHOOK_TOKEN = 'token';
    process.env.WAHOOAPI_ALLOWED_FILE_HOSTS = 'cdn.wahooligan.com';
  });

  it('downloads a bounded FIT file from the allowlisted CDN', async () => {
    const payload = fitPayload();
    fetchMock.mockResolvedValue(response(200, payload, { 'content-length': `${payload.length}` }));
    await expect(downloadWahooFITFile('https://cdn.wahooligan.com/file.fit')).resolves.toEqual(payload);
    expect(infoMock).toHaveBeenCalledWith('[WahooFITDownload] Request diagnostic.', expect.objectContaining({
      outcome: 'success', requestAttempt: 1, statusCode: 200,
    }));
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('rejects non-HTTPS and non-allowlisted URLs before fetching', async () => {
    await expect(downloadWahooFITFile('http://cdn.wahooligan.com/file.fit')).rejects.toBeInstanceOf(UnsafeWahooFileUrlError);
    await expect(downloadWahooFITFile('https://example.com/file.fit')).rejects.toBeInstanceOf(UnsafeWahooFileUrlError);
    await expect(downloadWahooFITFile('https://127.0.0.1/file.fit')).rejects.toBeInstanceOf(UnsafeWahooFileUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(infoMock).not.toHaveBeenCalled();
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('checks redirect destinations against the allowlist', async () => {
    fetchMock.mockResolvedValue(response(302, null, { location: 'https://attacker.example/file.fit' }));
    await expect(downloadWahooFITFile('https://cdn.wahooligan.com/file.fit')).rejects.toBeInstanceOf(UnsafeWahooFileUrlError);
  });

  it('rejects oversized and malformed payloads', async () => {
    fetchMock.mockResolvedValueOnce(response(200, fitPayload(), { 'content-length': `${30 * 1024 * 1024 + 1}` }));
    await expect(downloadWahooFITFile('https://cdn.wahooligan.com/large.fit')).rejects.toThrow('30MB');
    fetchMock.mockResolvedValueOnce(response(200, Buffer.from('not-fit')));
    await expect(downloadWahooFITFile('https://cdn.wahooligan.com/bad.fit')).rejects.toThrow('valid FIT');
  });

  it('does not expose a signed FIT URL when the HTTP client fails', async () => {
    const signedUrl = 'https://cdn.wahooligan.com/file.fit?signature=secret-value';
    fetchMock.mockRejectedValue(new Error(`request to ${signedUrl} failed`));

    await expect(downloadWahooFITFile(signedUrl)).rejects.toThrow('Wahoo FIT download request failed.');
    await expect(downloadWahooFITFile(signedUrl)).rejects.not.toThrow('secret-value');
    expect(warnMock).toHaveBeenCalledWith('[WahooFITDownload] Request diagnostic.', expect.objectContaining({
      outcome: 'request_error', statusCode: null,
    }));
    expect(JSON.stringify(warnMock.mock.calls)).not.toContain('secret-value');
    expect(JSON.stringify(warnMock.mock.calls)).not.toContain(signedUrl);
  });

  it('aborts a stalled FIT request at the provider deadline', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));

    const download = downloadWahooFITFile('https://cdn.wahooligan.com/file.fit');
    const expectation = expect(download).rejects.toThrow('Wahoo FIT download timed out.');
    await vi.advanceTimersByTimeAsync(WAHOO_FIT_DOWNLOAD_TIMEOUT_MS);

    await expectation;
    expect(warnMock).toHaveBeenCalledWith('[WahooFITDownload] Request diagnostic.', expect.objectContaining({
      outcome: 'timeout', statusCode: null, elapsedMs: WAHOO_FIT_DOWNLOAD_TIMEOUT_MS,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('logs bounded 504 metadata without retrying or exposing headers, URLs or bodies', async () => {
    vi.useFakeTimers();
    const signedUrl = 'https://cdn.wahooligan.com/private-workout.fit?signature=private-signature';
    const cdnId = 'synthetic-cdn-request';
    const originId = 'synthetic-origin-request';
    fetchMock.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 22_000);
      return response(504, Buffer.from('private-response-body'), {
        'x-cache': 'Error from cloudfront', age: '10', 'retry-after': '30',
        'x-amz-cf-id': cdnId, 'x-amz-request-id': originId,
        authorization: 'private-authorization', 'set-cookie': 'private-cookie',
        location: signedUrl,
      });
    });

    await expect(downloadWahooFITFile(signedUrl)).rejects.toMatchObject({ statusCode: 504 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledExactlyOnceWith('[WahooFITDownload] Request diagnostic.', {
      outcome: 'http_error', requestAttempt: 1, elapsedMs: 22_000,
      timeoutMs: WAHOO_FIT_DOWNLOAD_TIMEOUT_MS, statusCode: 504,
      cacheStatus: 'error', cacheAgeSeconds: 10, retryAfterSeconds: 30,
      cdnRequestIdHash: createHash('sha256').update(cdnId).digest('hex'),
      originRequestIdHash: createHash('sha256').update(originId).digest('hex'),
    });
    const logged = JSON.stringify(warnMock.mock.calls);
    for (const withheld of [signedUrl, 'private-workout', 'private-signature', 'private-response-body',
      'private-authorization', 'private-cookie', cdnId, originId]) {
      expect(logged).not.toContain(withheld);
    }
  });

  it('withholds unrecognized cache text, invalid numbers and oversized request identifiers', async () => {
    fetchMock.mockResolvedValue(response(503, null, {
      'x-cache': 'private-file-or-email', age: '9007199254740992',
      'retry-after': 'https://example.com/private-token',
      'x-amz-cf-id': 's'.repeat(257), 'x-amz-request-id': 't'.repeat(257),
    }));
    await expect(downloadWahooFITFile('https://cdn.wahooligan.com/file.fit')).rejects.toMatchObject({ statusCode: 503 });
    expect(warnMock).toHaveBeenCalledWith('[WahooFITDownload] Request diagnostic.', expect.objectContaining({
      cacheStatus: 'other', cacheAgeSeconds: null, retryAfterSeconds: null,
      cdnRequestIdHash: null, originRequestIdHash: null,
    }));
    expect(JSON.stringify(warnMock.mock.calls)).not.toContain('private-');
  });

  it('logs successful cache metadata and redirect request numbers without redirect URLs', async () => {
    const payload = fitPayload();
    const redirectedUrl = 'https://cdn.wahooligan.com/private-file.fit?signature=private-signature';
    fetchMock.mockResolvedValueOnce(response(302, null, { location: redirectedUrl }))
      .mockResolvedValueOnce(response(200, payload, { 'x-cache': 'Hit from cloudfront', age: '42' }));
    await expect(downloadWahooFITFile('https://cdn.wahooligan.com/start.fit')).resolves.toEqual(payload);
    expect(infoMock).toHaveBeenNthCalledWith(1, '[WahooFITDownload] Request diagnostic.', expect.objectContaining({
      outcome: 'redirect', requestAttempt: 1, statusCode: 302,
    }));
    expect(infoMock).toHaveBeenNthCalledWith(2, '[WahooFITDownload] Request diagnostic.', expect.objectContaining({
      outcome: 'success', requestAttempt: 2, statusCode: 200, cacheStatus: 'hit', cacheAgeSeconds: 42,
    }));
    expect(JSON.stringify(infoMock.mock.calls)).not.toContain('private-');
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('does not emit request diagnostics when a lifecycle guard stops before fetching', async () => {
    beforeRequestMock.mockRejectedValue(new Error('private-lifecycle-state'));
    await expect(downloadWahooFITFile('https://cdn.wahooligan.com/file.fit')).rejects.toThrow('Wahoo FIT download request failed.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(infoMock).not.toHaveBeenCalled();
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('does not let diagnostic logger failures change successful or failed downloads', async () => {
    const payload = fitPayload();
    infoMock.mockImplementation(() => { throw new Error('logger unavailable'); });
    fetchMock.mockResolvedValueOnce(response(200, payload));
    await expect(downloadWahooFITFile('https://cdn.wahooligan.com/file.fit')).resolves.toEqual(payload);

    warnMock.mockImplementation(() => { throw new Error('logger unavailable'); });
    fetchMock.mockResolvedValueOnce(response(504, null));
    await expect(downloadWahooFITFile('https://cdn.wahooligan.com/file.fit')).rejects.toMatchObject({ statusCode: 504 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not let diagnostic header-reading failures change a successful download', async () => {
    const payload = fitPayload();
    const result = response(200, payload);
    const readHeader = result.headers.get;
    result.headers.get = (name: string) => {
      if (name === 'x-cache') throw new Error('private-header-error');
      return readHeader(name);
    };
    fetchMock.mockResolvedValue(result);
    await expect(downloadWahooFITFile('https://cdn.wahooligan.com/file.fit')).resolves.toEqual(payload);
    expect(infoMock).not.toHaveBeenCalled();
    expect(warnMock).not.toHaveBeenCalled();
  });
});
