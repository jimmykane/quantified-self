import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import * as logger from 'firebase-functions/logger';
import { authenticateGarminWebhook } from './webhook-auth';

const SECRET = 'a'.repeat(64);
const FUNCTION = 'receiveGarminAPIHealthData';
const FUNCTIONS = [
  FUNCTION, 'insertGarminAPIActivityFileToQueue', 'deauthorizeGarminAPIUsers', 'receiveGarminAPIUserPermissions',
];

describe('Garmin webhook authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GARMINAPI_WEBHOOK_SECRET', SECRET);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  function authenticate(path: string, method = 'POST', functionName = FUNCTION) {
    const response = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    const request = { path, method };
    // Prove the shared guard never reads untrusted callback data.
    Object.defineProperty(request, 'body', { get() { throw new Error('body accessed'); } });
    Object.defineProperty(request, 'rawBody', { get() { throw new Error('rawBody accessed'); } });
    return { accepted: authenticateGarminWebhook(request as Request, response as unknown as Response, functionName), response };
  }

  it.each([`/${SECRET}/API`, `/${FUNCTION}/${SECRET}/API`])('accepts the exact protected path %s', path => {
    expect(authenticate(path).accepted).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('[GarminWebhook] Accepted callback route', {
      functionName: FUNCTION, authenticated: true, legacy: false,
    });
  });

  it.each([
    `/${'b'.repeat(64)}/API`, '/unknown', `/${FUNCTION}/unknown`,
    `/${SECRET}/API/`, `/${SECRET}/api`, `/extra/${SECRET}/API`,
    `/${SECRET}/API/extra`, `/%61${SECRET.slice(1)}/API`,
    `/${SECRET}%2FAPI`, `//${SECRET}/API`, `/${SECRET}/API?secret=${SECRET}`,
  ])('rejects an unprotected or malformed path %s', path => {
    const { accepted, response } = authenticate(path);
    expect(accepted).toBe(false);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each(['GET', 'PUT', 'DELETE', 'OPTIONS'])('rejects method %s', method => {
    const { accepted, response } = authenticate(`/${SECRET}/API`, method);
    expect(accepted).toBe(false);
    expect(response.status).toHaveBeenCalledWith(405);
    expect(authenticate('/', method).response.status).toHaveBeenCalledWith(405);
  });

  it.each(['', 'short', SECRET.toUpperCase(), SECRET + 'a', SECRET + '\n', SECRET + '\r\n',
    ' ' + SECRET, SECRET + ' ', '"' + SECRET + '"', 'null', '[]', '{invalid',
    JSON.stringify({ secret: SECRET }),
    JSON.stringify({ secret: SECRET, legacyUntil: '2026-10-03T11:00:00.000Z' }),
    JSON.stringify({ secret: 'short' }),
    JSON.stringify({ legacyUntil: '2026-10-03T11:00:00.000Z' }),
    JSON.stringify({ secret: 123 }),
  ])('fails closed on invalid configuration', value => {
    vi.stubEnv('GARMINAPI_WEBHOOK_SECRET', value);
    const { accepted, response } = authenticate(`/${SECRET}/API`);
    expect(accepted).toBe(false);
    expect(response.status).toHaveBeenCalledWith(503);
    expect(authenticate('/').response.status).toHaveBeenCalledWith(503);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each(FUNCTIONS)('supports protected and exact legacy routes during rollout for %s', functionName => {
    for (const path of ['/', `/${functionName}`, `/${functionName}/`]) {
      expect(authenticate(path, 'POST', functionName).accepted).toBe(true);
      expect(logger.info).toHaveBeenLastCalledWith('[GarminWebhook] Accepted callback route', {
        functionName, authenticated: false, legacy: true,
      });
    }
    for (const path of [`/${SECRET}/API`, `/${functionName}/${SECRET}/API`]) {
      expect(authenticate(path, 'POST', functionName).accepted).toBe(true);
      expect(logger.info).toHaveBeenLastCalledWith('[GarminWebhook] Accepted callback route', {
        functionName, authenticated: true, legacy: false,
      });
    }
    for (const path of [`/${'b'.repeat(64)}/API`, `/${functionName}/${'b'.repeat(64)}/API`, '/unknown']) {
      expect(authenticate(path, 'POST', functionName).response.status).toHaveBeenCalledWith(403);
    }
  });

  it('keeps both routes usable without consulting a cutoff clock', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock accessed'); });
    expect(authenticate('/').accepted).toBe(true);
    expect(authenticate(`/${SECRET}/API`).accepted).toBe(true);
  });

  it('never logs the secret or request path', () => {
    authenticate(`/${SECRET}/API`);
    authenticate('/');
    authenticate(`/${'b'.repeat(64)}/API`);
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(SECRET);
  });
});
