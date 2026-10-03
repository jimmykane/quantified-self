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
    '/', `/${FUNCTION}`, `/${FUNCTION}/`, `/${'b'.repeat(64)}/API`,
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
  });

  it.each(['', 'short', SECRET.toUpperCase(), SECRET + 'a', SECRET + '\n', SECRET + '\r\n',
    ' ' + SECRET, SECRET + ' ', '"' + SECRET + '"', 'null', '[]', '{invalid',
    JSON.stringify({ secret: SECRET }),
    JSON.stringify({ secret: SECRET, legacyUntil: '2026-10-03T11:00:00.000Z' }),
    JSON.stringify({ secret: 'short', legacyUntil: '2026-10-03T11:00:00.000Z' }),
    JSON.stringify({ legacyUntil: '2026-10-03T11:00:00.000Z' }),
    JSON.stringify({ secret: 123 }),
  ])('fails closed on invalid configuration', value => {
    vi.stubEnv('GARMINAPI_WEBHOOK_SECRET', value);
    const { accepted, response } = authenticate(`/${SECRET}/API`);
    expect(accepted).toBe(false);
    expect(response.status).toHaveBeenCalledWith(503);
    expect(authenticate('/').accepted).toBe(false);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each(FUNCTIONS)('requires the plain secret on protected paths for %s', functionName => {
    for (const path of ['/', `/${functionName}`, `/${functionName}/`, `/${'b'.repeat(64)}/API`, '/unknown']) {
      const { accepted, response } = authenticate(path, 'POST', functionName);
      expect(accepted).toBe(false);
      expect(response.status).toHaveBeenCalledWith(403);
    }
    expect(logger.info).not.toHaveBeenCalled();
    expect(authenticate(`/${SECRET}/API`, 'POST', functionName).accepted).toBe(true);
    expect(authenticate(`/${functionName}/${SECRET}/API`, 'POST', functionName).accepted).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('[GarminWebhook] Accepted callback route', {
      functionName, authenticated: true, legacy: false,
    });
  });

  it('never logs the secret or request path', () => {
    authenticate(`/${SECRET}/API`);
    authenticate(`/${'b'.repeat(64)}/API`);
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(SECRET);
  });
});
