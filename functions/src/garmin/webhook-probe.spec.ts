import type { Request, Response } from 'express';
import * as logger from 'firebase-functions/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleGarminWebhookProbe } from './webhook-probe';

const markerPath = '/qs-path-marker-20261002';
const markerQuery = '?probe=qs-query-marker-20261002';

function requestFor(url: string, method = 'POST', headers: Record<string, string> = {}): Request {
  const request = {
    method,
    path: url.split('?')[0],
    url,
    get: (name: string) => headers[name],
  };
  Object.defineProperties(request, {
    body: { get: () => { throw new Error('Probe must not inspect the payload'); } },
    rawBody: { get: () => { throw new Error('Probe must not inspect the raw payload'); } },
  });
  return request as Request;
}

function responseFor(): Response {
  const response = { set: vi.fn(), status: vi.fn(), send: vi.fn() };
  response.set.mockReturnValue(response);
  response.status.mockReturnValue(response);
  return response as unknown as Response;
}

describe('Garmin webhook URL probe', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([markerPath, `/garminWebhookProbe${markerPath}`])(
    'acknowledges an intact URL without inspecting its payload: %s', path => {
      const response = responseFor();
      handleGarminWebhookProbe(requestFor(`${path}${markerQuery}`, 'POST', {
        'garmin-client-id': 'a-client-id-that-must-not-be-logged',
      }), response);

      expect(response.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.send).toHaveBeenCalledWith('OK');
      expect(logger.info).toHaveBeenCalledExactlyOnceWith('[GarminWebhookProbe] URL markers received', {
        pathMatches: true, queryMatches: true, manualTest: false, garminClientIdPresent: true,
      });
    },
  );

  it.each([
    ['/', false, false],
    [markerPath, true, false],
    [`/different${markerQuery}`, false, true],
    [`${markerPath}?probe=wrong`, true, false],
    [`${markerPath}${markerQuery}&probe=qs-query-marker-20261002`, true, false],
    [`${markerPath}${markerQuery}&probe=wrong`, true, false],
    [`${markerPath}/extra${markerQuery}`, false, true],
    [`${markerPath}?probe[nested]=qs-query-marker-20261002`, true, false],
  ])('reports missing, changed, or ambiguous markers for %s', (url, pathMatches, queryMatches) => {
    const response = responseFor();
    handleGarminWebhookProbe(requestFor(url), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(logger.info).toHaveBeenCalledWith('[GarminWebhookProbe] URL markers received', {
      pathMatches, queryMatches, manualTest: false, garminClientIdPresent: false,
    });
  });

  it('labels manual smoke requests and logs only boolean diagnostics', () => {
    const request = requestFor(`${markerPath}${markerQuery}&token=private-token`, 'POST', {
      'x-qs-probe-test': 'manual', 'authorization': 'Bearer private-access-token',
    });
    handleGarminWebhookProbe(request, responseFor());

    expect(logger.info).toHaveBeenCalledExactlyOnceWith('[GarminWebhookProbe] URL markers received', {
      pathMatches: true, queryMatches: true, manualTest: true, garminClientIdPresent: false,
    });
  });

  it('allows a GET reachability check without creating a delivery log', () => {
    const response = responseFor();
    handleGarminWebhookProbe(requestFor(`${markerPath}${markerQuery}`, 'GET'), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('rejects unrelated HTTP methods without logging their inputs', () => {
    const response = responseFor();
    handleGarminWebhookProbe(requestFor(`${markerPath}${markerQuery}`, 'DELETE'), response);

    expect(response.set).toHaveBeenCalledWith('Allow', 'GET, POST');
    expect(response.status).toHaveBeenCalledWith(405);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
