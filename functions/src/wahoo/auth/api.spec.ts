import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.mock('node-fetch', () => ({ default: (...args: unknown[]) => fetchMock(...args) }));

import { deauthorizeWahooUser, getWahooUserID, requestWahooAPI, WahooAPIRequestError } from './api';
import { WAHOO_API_REQUEST_TIMEOUT_MS } from '../constants';

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] || null },
    text: vi.fn().mockResolvedValue(body === null ? '' : JSON.stringify(body)),
  };
}

describe('Wahoo auth API helpers', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('gets the stable Wahoo user id with a bearer token', async () => {
    fetchMock.mockResolvedValue(response(200, { id: 60462 }));
    await expect(getWahooUserID('access')).resolves.toBe('60462');
    expect(fetchMock).toHaveBeenCalledWith('https://api.wahooligan.com/v1/user', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer access' }),
    }));
  });

  it('deauthorizes with DELETE', async () => {
    fetchMock.mockResolvedValue(response(204, null));
    await deauthorizeWahooUser('access');
    expect(fetchMock).toHaveBeenCalledWith('https://api.wahooligan.com/v1/permissions', expect.objectContaining({ method: 'DELETE' }));
  });

  it('exposes rate-limit reset information on errors', async () => {
    fetchMock.mockResolvedValue(response(429, { error: 'rate limited' }, { 'x-ratelimit-reset': '300' }));
    await expect(requestWahooAPI('access', '/v1/workouts')).rejects.toMatchObject<WahooAPIRequestError>({
      statusCode: 429,
      resetAfterSeconds: 300,
    });
  });

  it('aborts a stalled API request at the provider deadline', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));

    const request = requestWahooAPI('access', '/v1/workouts');
    const expectation = expect(request).rejects.toThrow('Wahoo API request timed out.');
    await vi.advanceTimersByTimeAsync(WAHOO_API_REQUEST_TIMEOUT_MS);

    await expectation;
  });
});
