import { currentHistoryExecution } from '../connection-history/context';
import fetch, { type Response } from 'node-fetch';
import { createHash } from 'crypto';
import * as logger from 'firebase-functions/logger';
import * as net from 'net';
import { config } from '../config';
import { MAX_ACTIVITY_UPLOAD_BYTES, MAX_ACTIVITY_UPLOAD_BYTES_LABEL } from '../shared/activity-processing-config';
import { WAHOO_FIT_DOWNLOAD_TIMEOUT_MS } from './constants';
import { WahooRequestTimeoutError, withWahooRequestTimeout } from './request-timeout';

const MAX_REDIRECTS = 3;

type DownloadRequestOutcome = 'success' | 'redirect' | 'http_error' | 'timeout' | 'request_error';

function numericHeader(value: string | null): number | null {
  if (!value || value.length > 16 || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function requestIdHash(value: string | null): string | null {
  return value && value.length <= 256
    ? createHash('sha256').update(value).digest('hex')
    : null;
}

function cacheStatus(value: string | null): string {
  switch (value?.toLowerCase()) {
    case 'hit from cloudfront': return 'hit';
    case 'miss from cloudfront': return 'miss';
    case 'error from cloudfront': return 'error';
    case 'refreshhit from cloudfront': return 'refresh_hit';
    default: return value === null ? 'missing' : 'other';
  }
}

function logDownloadRequest(
  startedAtMs: number,
  requestAttempt: number,
  response: Response | undefined,
  outcome: DownloadRequestOutcome,
): void {
  try {
    const readHeader = (name: string) => response?.headers.get(name) ?? null;
    const details = {
      outcome,
      requestAttempt,
      elapsedMs: Math.max(0, Date.now() - startedAtMs),
      timeoutMs: WAHOO_FIT_DOWNLOAD_TIMEOUT_MS,
      statusCode: response?.status ?? null,
      cacheStatus: cacheStatus(readHeader('x-cache')),
      cacheAgeSeconds: numericHeader(readHeader('age')),
      retryAfterSeconds: numericHeader(readHeader('retry-after')),
      cdnRequestIdHash: requestIdHash(readHeader('x-amz-cf-id')),
      originRequestIdHash: requestIdHash(readHeader('x-amz-request-id')),
    };
    const log = outcome === 'success' || outcome === 'redirect' ? logger.info : logger.warn;
    log('[WahooFITDownload] Request diagnostic.', details);
  } catch {
    // Optional diagnostics must never change the download or its retry behavior.
  }
}

export class UnsafeWahooFileUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeWahooFileUrlError';
  }
}

function assertAllowedUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeWahooFileUrlError('Wahoo FIT URL is invalid.');
  }
  if (url.protocol !== 'https:') {
    throw new UnsafeWahooFileUrlError('Wahoo FIT URL must use HTTPS.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(hostname) !== 0 || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new UnsafeWahooFileUrlError('Wahoo FIT URL must use a public provider host.');
  }
  if (!config.wahooapi.allowed_file_hosts.includes(hostname)) {
    throw new UnsafeWahooFileUrlError('Wahoo FIT URL host is not allowlisted.');
  }
  if (url.username || url.password) {
    throw new UnsafeWahooFileUrlError('Wahoo FIT URL must not contain credentials.');
  }
  return url;
}

function assertFitPayload(payload: Buffer): void {
  if (payload.length < 12 || payload.subarray(8, 12).toString('ascii') !== '.FIT') {
    throw new Error('Wahoo file is not a valid FIT payload.');
  }
}

async function readBoundedBody(body: NodeJS.ReadableStream | null, contentLength: string | null): Promise<Buffer> {
  const declaredLength = contentLength ? Number(contentLength) : null;
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > MAX_ACTIVITY_UPLOAD_BYTES) {
    throw new Error(`Wahoo FIT file exceeds the ${MAX_ACTIVITY_UPLOAD_BYTES_LABEL} limit.`);
  }
  if (!body) throw new Error('Wahoo FIT response did not contain a body.');
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of body as any) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_ACTIVITY_UPLOAD_BYTES) {
      throw new Error(`Wahoo FIT file exceeds the ${MAX_ACTIVITY_UPLOAD_BYTES_LABEL} limit.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function downloadWahooFITFile(rawUrl: string): Promise<Buffer> {
  let currentUrl = assertAllowedUrl(rawUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    let requestStartedAtMs: number | undefined;
    let response: Response | undefined;
    let outcome: DownloadRequestOutcome = 'request_error';
    try {
      const result = await withWahooRequestTimeout(WAHOO_FIT_DOWNLOAD_TIMEOUT_MS, async (signal) => {
        await currentHistoryExecution()?.beforeRequest();
        requestStartedAtMs = Date.now();
        response = await fetch(currentUrl.toString(), {
          method: 'GET',
          redirect: 'manual',
          headers: { Accept: 'application/octet-stream' },
          signal,
        });
        if (response.status >= 300 && response.status < 400) {
          return { redirectLocation: response.headers.get('location'), payload: null, status: response.status };
        }
        if (!response.ok) {
          const error = new Error(`Wahoo FIT download failed with ${response.status}`) as Error & { statusCode?: number };
          error.statusCode = response.status;
          throw error;
        }
        return {
          redirectLocation: null,
          payload: await readBoundedBody(response.body, response.headers.get('content-length')),
          status: response.status,
        };
      });
      if (result.status >= 300 && result.status < 400) {
        if (!result.redirectLocation || redirectCount === MAX_REDIRECTS) {
          throw new UnsafeWahooFileUrlError('Wahoo FIT redirect could not be followed safely.');
        }
        currentUrl = assertAllowedUrl(new URL(result.redirectLocation, currentUrl).toString());
        outcome = 'redirect';
        continue;
      }
      if (!result.payload) throw new Error('Wahoo FIT response did not contain a body.');
      assertFitPayload(result.payload);
      outcome = 'success';
      return result.payload;
    } catch (error) {
      outcome = error instanceof WahooRequestTimeoutError ? 'timeout'
        : response && response.status >= 400 ? 'http_error' : 'request_error';
      if (error instanceof UnsafeWahooFileUrlError) throw error;
      if (error instanceof WahooRequestTimeoutError) throw new Error('Wahoo FIT download timed out.');
      if ((error as { statusCode?: unknown })?.statusCode) throw error;
      const errorMessage = error instanceof Error ? error.message : '';
      if (errorMessage.includes(MAX_ACTIVITY_UPLOAD_BYTES_LABEL) || errorMessage.includes('valid FIT')) throw error;
      throw new Error('Wahoo FIT download request failed.');
    } finally {
      if (requestStartedAtMs !== undefined) {
        logDownloadRequest(requestStartedAtMs, redirectCount + 1, response, outcome);
      }
    }
  }
  throw new UnsafeWahooFileUrlError('Wahoo FIT redirect limit exceeded.');
}
