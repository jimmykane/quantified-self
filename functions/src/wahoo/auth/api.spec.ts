import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const cooldownMock = vi.fn();
const extendCooldownMock = vi.fn();
vi.mock('node-fetch', () => ({ default: (...args: unknown[]) => fetchMock(...args) }));
vi.mock('../rate-limit', async importOriginal => ({
  ...await importOriginal<typeof import('../rate-limit')>(),
  getWahooRateLimitCooldownSeconds: (...args: unknown[]) => cooldownMock(...args),
  extendWahooRateLimitCooldown: (...args: unknown[]) => extendCooldownMock(...args),
}));

import { deauthorizeWahooUser, getWahooUserID, requestWahooAPI, WahooAPIRequestError } from './api';
import { WAHOO_API_REQUEST_TIMEOUT_MS } from '../constants';
import * as logger from 'firebase-functions/logger';

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
    cooldownMock.mockResolvedValue(0);
    extendCooldownMock.mockImplementation(async (seconds: number) => seconds + 5);
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

  it('sends workout file uploads as URL-encoded form data without exposing the bearer token in the body', async () => {
    fetchMock.mockResolvedValue(response(201, { token: 'upload-token', status: 'pending' }));
    const form = new URLSearchParams();
    form.set('workout_file_upload[file]', 'data:application/vnd.fit;base64,RklU');
    form.set('workout_file_upload[filename]', 'ride.fit');

    await requestWahooAPI('access', '/v1/workout_file_uploads', { method: 'POST', form });

    expect(fetchMock).toHaveBeenCalledWith('https://api.wahooligan.com/v1/workout_file_uploads', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer access',
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
      body: form.toString(),
    }));
  });

  it('sends route updates as URL-encoded PUT requests', async () => {
    fetchMock.mockResolvedValue(response(200, { id: 42 }));
    const form = new URLSearchParams();
    form.set('route[name]', 'Morning ride');
    form.set('route[provider_updated_at]', '2026-07-22T09:00:00.000Z');

    await requestWahooAPI('access', '/v1/routes/42', { method: 'PUT', form });

    expect(fetchMock).toHaveBeenCalledWith('https://api.wahooligan.com/v1/routes/42', expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({
        Authorization: 'Bearer access',
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
      body: form.toString(),
    }));
  });

  it('exposes rate-limit reset information on errors', async () => {
    fetchMock.mockResolvedValue(response(429, { error: 'rate limited' }, { 'x-ratelimit-reset': '300' }));
    await expect(requestWahooAPI('access', '/v1/workouts')).rejects.toMatchObject<WahooAPIRequestError>({
      statusCode: 429,
      resetAfterSeconds: 305,
    });
    expect(extendCooldownMock).toHaveBeenCalledExactlyOnceWith(300);
  });

  it('prevents requests for another account and endpoint during the shared cooldown', async () => {
    cooldownMock.mockResolvedValue(1800);
    await expect(requestWahooAPI('other-access', '/v1/workout_file_uploads', 'POST')).rejects.toMatchObject({
      statusCode: 429, resetAfterSeconds: 1800,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(extendCooldownMock).not.toHaveBeenCalled();
  });

  it('fails before provider work when the shared deadline cannot be read', async () => {
    cooldownMock.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(requestWahooAPI('access', '/v1/workouts')).rejects.toMatchObject({ requestStarted: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs only numeric quota diagnostics, never headers, paths, credentials or provider bodies', async () => {
    fetchMock.mockResolvedValue(response(429, { error: 'PRIVATE' }, {
      'x-ratelimit-reset': '3600', 'x-ratelimit-limit': '5000,1000,200', 'x-ratelimit-remaining': '3,0,0',
    }));
    await expect(requestWahooAPI('PRIVATE', '/v1/workouts/PRIVATE')).rejects.toMatchObject({ resetAfterSeconds: 3605 });
    expect(logger.warn).toHaveBeenCalledWith('[WahooAPI] Application API quota exceeded; shared cooldown requested.', {
      retryAfterSeconds: 3605, quotaLimits: [5000, 1000, 200], quotaRemaining: [3, 0, 0],
    });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('PRIVATE');
  });

  it('keeps a rejected upload retryable if persisting the cooldown fails', async () => {
    fetchMock.mockResolvedValue(response(429, null));
    extendCooldownMock.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(requestWahooAPI('access', '/v1/workout_file_uploads', 'POST')).rejects.toMatchObject({
      statusCode: 429, resetAfterSeconds: 300,
    });
  });

  it('does not let diagnostic failures change a definitive quota rejection', async () => {
    fetchMock.mockResolvedValue(response(429, null));
    vi.mocked(logger.warn).mockImplementationOnce(() => { throw new Error('logger unavailable'); });
    await expect(requestWahooAPI('access', '/v1/workout_file_uploads', 'POST')).rejects.toMatchObject({ statusCode: 429 });
  });

  it('retains the parsed provider error body for safe caller diagnostics', async () => {
    const body = { errors: { workout_file_upload: ['already exists'] } };
    fetchMock.mockResolvedValue(response(422, body));

    const error = await requestWahooAPI('access', '/v1/workout_file_uploads', 'POST').catch((requestError) => requestError);
    expect(error).toMatchObject<WahooAPIRequestError>({
      statusCode: 422,
      responseBody: body,
    });
    expect(Object.keys(error)).not.toContain('responseBody');
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
