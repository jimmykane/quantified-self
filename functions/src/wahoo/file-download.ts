import fetch from 'node-fetch';
import * as net from 'net';
import { config } from '../config';
import { MAX_ACTIVITY_UPLOAD_BYTES } from '../shared/activity-processing-config';
import { WAHOO_FIT_DOWNLOAD_TIMEOUT_MS } from './constants';
import { WahooRequestTimeoutError, withWahooRequestTimeout } from './request-timeout';

const MAX_REDIRECTS = 3;

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
    throw new Error('Wahoo FIT file exceeds the 20 MB limit.');
  }
  if (!body) throw new Error('Wahoo FIT response did not contain a body.');
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of body as any) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_ACTIVITY_UPLOAD_BYTES) {
      throw new Error('Wahoo FIT file exceeds the 20 MB limit.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function downloadWahooFITFile(rawUrl: string): Promise<Buffer> {
  let currentUrl = assertAllowedUrl(rawUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    try {
      const result = await withWahooRequestTimeout(WAHOO_FIT_DOWNLOAD_TIMEOUT_MS, async (signal) => {
        const response = await fetch(currentUrl.toString(), {
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
        continue;
      }
      if (!result.payload) throw new Error('Wahoo FIT response did not contain a body.');
      assertFitPayload(result.payload);
      return result.payload;
    } catch (error) {
      if (error instanceof UnsafeWahooFileUrlError) throw error;
      if (error instanceof WahooRequestTimeoutError) throw new Error('Wahoo FIT download timed out.');
      if ((error as { statusCode?: unknown })?.statusCode) throw error;
      const errorMessage = error instanceof Error ? error.message : '';
      if (errorMessage.includes('20 MB') || errorMessage.includes('valid FIT')) throw error;
      throw new Error('Wahoo FIT download request failed.');
    }
  }
  throw new UnsafeWahooFileUrlError('Wahoo FIT redirect limit exceeded.');
}
