import fetch from 'node-fetch';
import * as net from 'net';

import {
  MAX_ACTIVITY_UPLOAD_BYTES,
  MAX_ACTIVITY_UPLOAD_BYTES_LABEL,
} from '../shared/activity-processing-config';
import {
  COROS_FIT_DOWNLOAD_ALLOWED_HOSTS,
  COROS_FIT_DOWNLOAD_ALLOWED_HOST_SUFFIXES,
  COROS_FIT_DOWNLOAD_TIMEOUT_MS,
} from './constants';

const MAX_REDIRECTS = 3;
const COROS_FIT_PATH_PATTERN = /^\/fit\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,256}\.fit$/i;

export class PermanentCOROSFITDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentCOROSFITDownloadError';
  }
}

export class UnsafeCOROSFileUrlError extends PermanentCOROSFITDownloadError {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeCOROSFileUrlError';
  }
}

function assertAllowedUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeCOROSFileUrlError('COROS FIT URL is invalid.');
  }
  if (url.protocol !== 'https:') {
    throw new UnsafeCOROSFileUrlError('COROS FIT URL must use HTTPS.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(hostname) !== 0
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')) {
    throw new UnsafeCOROSFileUrlError('COROS FIT URL must use a public provider host.');
  }
  const isAllowedHost = COROS_FIT_DOWNLOAD_ALLOWED_HOSTS.some(allowedHost => allowedHost === hostname)
    || COROS_FIT_DOWNLOAD_ALLOWED_HOST_SUFFIXES.some(allowedSuffix => hostname.endsWith(allowedSuffix));
  if (!isAllowedHost) {
    throw new UnsafeCOROSFileUrlError('COROS FIT URL host is not allowlisted.');
  }
  if (url.username || url.password || url.port) {
    throw new UnsafeCOROSFileUrlError('COROS FIT URL must not contain credentials or a custom port.');
  }
  if (!COROS_FIT_PATH_PATTERN.test(url.pathname)) {
    throw new UnsafeCOROSFileUrlError('COROS FIT URL path is invalid.');
  }
  return url;
}

function assertFitPayload(payload: Buffer): void {
  if (payload.length < 12 || payload.subarray(8, 12).toString('ascii') !== '.FIT') {
    throw new PermanentCOROSFITDownloadError('COROS file is not a valid FIT payload.');
  }
}

async function readBoundedBody(body: NodeJS.ReadableStream | null, contentLength: string | null): Promise<Buffer> {
  const declaredLength = contentLength ? Number(contentLength) : null;
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > MAX_ACTIVITY_UPLOAD_BYTES) {
    throw new PermanentCOROSFITDownloadError(`COROS FIT file exceeds the ${MAX_ACTIVITY_UPLOAD_BYTES_LABEL} limit.`);
  }
  if (!body) {
    throw new PermanentCOROSFITDownloadError('COROS FIT response did not contain a body.');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_ACTIVITY_UPLOAD_BYTES) {
      throw new PermanentCOROSFITDownloadError(`COROS FIT file exceeds the ${MAX_ACTIVITY_UPLOAD_BYTES_LABEL} limit.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, totalBytes);
}

async function fetchWithTimeout(url: URL): Promise<{
  status: number;
  redirectLocation: string | null;
  payload: Buffer | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COROS_FIT_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'application/octet-stream' },
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      return {
        status: response.status,
        redirectLocation: response.headers.get('location'),
        payload: null,
      };
    }
    if (!response.ok) {
      const error = new Error(`COROS FIT download failed with ${response.status}`) as Error & { statusCode?: number };
      error.statusCode = response.status;
      throw error;
    }
    return {
      status: response.status,
      redirectLocation: null,
      payload: await readBoundedBody(response.body, response.headers.get('content-length')),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Downloads only bounded FIT payloads from the host documented by COROS. */
export async function downloadCOROSFITFile(rawUrl: string): Promise<Buffer> {
  let currentUrl = assertAllowedUrl(rawUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    try {
      const result = await fetchWithTimeout(currentUrl);
      if (result.status >= 300 && result.status < 400) {
        if (!result.redirectLocation || redirectCount === MAX_REDIRECTS) {
          throw new UnsafeCOROSFileUrlError('COROS FIT redirect could not be followed safely.');
        }
        currentUrl = assertAllowedUrl(new URL(result.redirectLocation, currentUrl).toString());
        continue;
      }
      if (!result.payload) {
        throw new PermanentCOROSFITDownloadError('COROS FIT response did not contain a body.');
      }
      assertFitPayload(result.payload);
      return result.payload;
    } catch (error) {
      if (error instanceof PermanentCOROSFITDownloadError) throw error;
      if ((error as { statusCode?: unknown } | null)?.statusCode) throw error;
      if ((error as { name?: unknown } | null)?.name === 'AbortError') {
        throw new Error('COROS FIT download timed out.');
      }
      throw new Error('COROS FIT download request failed.');
    }
  }
  throw new UnsafeCOROSFileUrlError('COROS FIT redirect limit exceeded.');
}
