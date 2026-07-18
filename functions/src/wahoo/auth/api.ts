import fetch from 'node-fetch';
import { WAHOO_API_BASE_URL, WAHOO_API_REQUEST_TIMEOUT_MS } from '../constants';
import { WahooRequestTimeoutError, withWahooRequestTimeout } from '../request-timeout';

export class WahooAPIRequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly resetAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'WahooAPIRequestError';
  }
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
  method: 'GET' | 'DELETE' = 'GET',
): Promise<{ data: T; rateLimit: { limit: string | null; remaining: string | null; resetAfterSeconds: number | null } }> {
  let response;
  let body: unknown;
  try {
    ({ response, body } = await withWahooRequestTimeout(WAHOO_API_REQUEST_TIMEOUT_MS, async (signal) => {
      const result = await fetch(`${WAHOO_API_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal,
      });
      return { response: result, body: await parseResponseBody(result) };
    }));
  } catch (error) {
    if (error instanceof WahooRequestTimeoutError) throw new Error('Wahoo API request timed out.');
    throw new Error('Wahoo API request failed.');
  }
  const resetAfterSeconds = parseResetHeader(response.headers.get('x-ratelimit-reset'));
  if (!response.ok) {
    throw new WahooAPIRequestError(
      `Wahoo API ${method} ${path} failed with ${response.status}`,
      response.status,
      resetAfterSeconds,
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
