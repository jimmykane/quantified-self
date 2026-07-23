import fetch from 'node-fetch';
import { WAHOO_API_BASE_URL, WAHOO_API_REQUEST_TIMEOUT_MS } from '../constants';
import { WahooRequestTimeoutError, withWahooRequestTimeout } from '../request-timeout';

export class WahooAPIRequestError extends Error {
  public readonly responseBody!: unknown;

  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly resetAfterSeconds: number | null = null,
    responseBody: unknown = null,
  ) {
    super(message);
    this.name = 'WahooAPIRequestError';
    Object.defineProperty(this, 'responseBody', {
      value: responseBody,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}

export class WahooAPITransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WahooAPITransportError';
  }
}

export type WahooAPIMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface WahooAPIRequestOptions {
  method?: WahooAPIMethod;
  form?: URLSearchParams;
}

function parseResetHeader(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.split(',')[0]?.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function parseResponseBody(response: { text(): Promise<string> }): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function requestWahooAPI<T>(
  accessToken: string,
  path: string,
  methodOrOptions: WahooAPIMethod | WahooAPIRequestOptions = 'GET',
): Promise<{ data: T; rateLimit: { limit: string | null; remaining: string | null; resetAfterSeconds: number | null } }> {
  const options = typeof methodOrOptions === 'string' ? { method: methodOrOptions } : methodOrOptions;
  const method = options.method || 'GET';
  let response;
  let body: unknown;
  try {
    ({ response, body } = await withWahooRequestTimeout(WAHOO_API_REQUEST_TIMEOUT_MS, async (signal) => {
      const result = await fetch(`${WAHOO_API_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(options.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: options.form?.toString(),
        signal,
      });
      return { response: result, body: await parseResponseBody(result) };
    }));
  } catch (error) {
    if (error instanceof WahooRequestTimeoutError) throw new WahooAPITransportError('Wahoo API request timed out.');
    throw new WahooAPITransportError('Wahoo API request failed.');
  }
  const resetAfterSeconds = parseResetHeader(response.headers.get('x-ratelimit-reset'));
  if (!response.ok) {
    throw new WahooAPIRequestError(
      `Wahoo API ${method} ${path} failed with ${response.status}`,
      response.status,
      resetAfterSeconds,
      body,
    );
  }
  return {
    data: body as T,
    rateLimit: {
      limit: response.headers.get('x-ratelimit-limit'),
      remaining: response.headers.get('x-ratelimit-remaining'),
      resetAfterSeconds,
    },
  };
}

export async function getWahooUserID(accessToken: string): Promise<string> {
  const { data } = await requestWahooAPI<{ id?: number | string }>(accessToken, '/v1/user');
  const userID = `${data?.id ?? ''}`.trim();
  if (!userID) throw new Error('Wahoo user ID was missing from /v1/user');
  return userID;
}

export async function deauthorizeWahooUser(accessToken: string): Promise<void> {
  await requestWahooAPI<unknown>(accessToken, '/v1/permissions', 'DELETE');
}
