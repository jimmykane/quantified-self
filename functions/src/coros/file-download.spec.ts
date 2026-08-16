import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.mock('node-fetch', () => ({ default: (...args: unknown[]) => fetchMock(...args) }));

import {
  downloadCOROSFITFile,
  PermanentCOROSFITDownloadError,
  UnsafeCOROSFileUrlError,
} from './file-download';
import { COROS_FIT_DOWNLOAD_TIMEOUT_MS } from './constants';

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

describe('downloadCOROSFITFile', () => {
  const ossFitUrl = 'https://oss.coros.com/fit/407419767966679040/418408855184113664.fit';
  const cloudFrontFitUrl = 'https://d31oxp44ddzkyk.cloudfront.net/fit/430290351243149312/479633578857103363.fit';

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('downloads a bounded FIT file from the COROS host', async () => {
    const payload = fitPayload();
    fetchMock.mockResolvedValue(response(200, payload, { 'content-length': `${payload.length}` }));

    await expect(downloadCOROSFITFile(ossFitUrl)).resolves.toEqual(payload);
  });

  it('downloads from rotating CloudFront distributions returned by COROS', async () => {
    const payload = fitPayload();
    fetchMock.mockResolvedValue(response(200, payload, { 'content-length': `${payload.length}` }));

    await expect(downloadCOROSFITFile(cloudFrontFitUrl)).resolves.toEqual(payload);
  });

  it('rejects unsafe URLs before fetching', async () => {
    await expect(downloadCOROSFITFile(ossFitUrl.replace('https:', 'http:'))).rejects.toBeInstanceOf(UnsafeCOROSFileUrlError);
    await expect(downloadCOROSFITFile('https://example.com/fit/407419767966679040/418408855184113664.fit')).rejects.toBeInstanceOf(UnsafeCOROSFileUrlError);
    await expect(downloadCOROSFITFile('https://cloudfront.net/fit/407419767966679040/418408855184113664.fit')).rejects.toBeInstanceOf(UnsafeCOROSFileUrlError);
    await expect(downloadCOROSFITFile('https://d31oxp44ddzkyk.cloudfront.net.evil.example/fit/407419767966679040/418408855184113664.fit')).rejects.toBeInstanceOf(UnsafeCOROSFileUrlError);
    await expect(downloadCOROSFITFile('https://127.0.0.1/fit/407419767966679040/418408855184113664.fit')).rejects.toBeInstanceOf(UnsafeCOROSFileUrlError);
    await expect(downloadCOROSFITFile('https://user:pass@oss.coros.com/fit/407419767966679040/418408855184113664.fit')).rejects.toBeInstanceOf(UnsafeCOROSFileUrlError);
    await expect(downloadCOROSFITFile('https://d31oxp44ddzkyk.cloudfront.net/not-fit/activity.fit')).rejects.toBeInstanceOf(UnsafeCOROSFileUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates every redirect destination', async () => {
    fetchMock.mockResolvedValue(response(302, null, { location: 'https://attacker.example/fit/407419767966679040/418408855184113664.fit' }));

    await expect(downloadCOROSFITFile(ossFitUrl)).rejects.toBeInstanceOf(UnsafeCOROSFileUrlError);
  });

  it('rejects oversized and malformed FIT payloads permanently', async () => {
    fetchMock.mockResolvedValueOnce(response(200, fitPayload(), { 'content-length': `${30 * 1024 * 1024 + 1}` }));
    await expect(downloadCOROSFITFile(ossFitUrl))
      .rejects.toBeInstanceOf(PermanentCOROSFITDownloadError);

    fetchMock.mockResolvedValueOnce(response(200, Buffer.from('not-fit')));
    await expect(downloadCOROSFITFile(ossFitUrl))
      .rejects.toThrow('valid FIT');
  });

  it('does not expose a signed FIT URL when the HTTP client fails', async () => {
    const signedUrl = `${cloudFrontFitUrl}?signature=secret-value`;
    fetchMock.mockRejectedValue(new Error(`request to ${signedUrl} failed`));

    await expect(downloadCOROSFITFile(signedUrl)).rejects.toThrow('COROS FIT download request failed.');
    await expect(downloadCOROSFITFile(signedUrl)).rejects.not.toThrow('secret-value');
  });

  it('aborts a stalled FIT request at the provider deadline', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));

    const download = downloadCOROSFITFile(ossFitUrl);
    const expectation = expect(download).rejects.toThrow('COROS FIT download timed out.');
    await vi.advanceTimersByTimeAsync(COROS_FIT_DOWNLOAD_TIMEOUT_MS);

    await expectation;
  });
});
