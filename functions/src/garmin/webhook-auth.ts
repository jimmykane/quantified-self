import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import * as logger from 'firebase-functions/logger';
import { SECRET_PARAMS } from '../secrets';

const SECRET_PATTERN = /^[a-f0-9]{64}$/;
const MAX_MIGRATION_WINDOW_MS = 24 * 60 * 60 * 1000;

interface WebhookCredential {
  secret: string;
  legacyUntilMs: number;
}

function readCredential(now: number): WebhookCredential | null {
  const value = SECRET_PARAMS.GARMINAPI_WEBHOOK_SECRET.value();
  if (SECRET_PATTERN.test(value)) return { secret: value, legacyUntilMs: 0 };
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed.secret !== 'string' || !SECRET_PATTERN.test(parsed.secret)) return null;
    let legacyUntilMs = 0;
    if (parsed.legacyUntil !== undefined) {
      if (typeof parsed.legacyUntil !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(parsed.legacyUntil)) return null;
      legacyUntilMs = Date.parse(parsed.legacyUntil);
      if (!Number.isFinite(legacyUntilMs)
        || new Date(legacyUntilMs).toISOString() !== parsed.legacyUntil
        || legacyUntilMs > now + MAX_MIGRATION_WINDOW_MS) return null;
    }
    return { secret: parsed.secret, legacyUntilMs };
  } catch {
    return null;
  }
}

/** Authenticate before reading the payload or touching account/queue state. */
export function authenticateGarminWebhook(
  request: Request,
  response: Response,
  functionName: string,
): boolean {
  if (request.method !== 'POST') {
    response.status(405).send('Method Not Allowed');
    return false;
  }
  const now = Date.now();
  const credential = readCredential(now);
  if (!credential) {
    logger.error('[GarminWebhook] Credential configuration unavailable', { functionName });
    response.status(503).send('Unavailable');
    return false;
  }
  // Functions/framework variants may retain the deployed function prefix.
  // Never decode, trim or accept arbitrary suffixes of a secret-bearing path.
  const prefix = `/${functionName}`;
  const path = request.path === prefix ? '/'
    : request.path?.startsWith(`${prefix}/`) ? request.path.slice(prefix.length)
      : request.path;
  const expectedPath = `/${credential.secret}/API`;
  const authenticated = typeof path === 'string' && path.length <= 256
    && timingSafeEqual(
      createHash('sha256').update(path).digest(),
      createHash('sha256').update(expectedPath).digest(),
    );
  const legacy = path === '/' && now < credential.legacyUntilMs;
  if (!authenticated && !legacy) {
    response.status(403).send('Forbidden');
    return false;
  }
  // Request URLs can contain the credential. Only log fixed route facts.
  logger.info('[GarminWebhook] Accepted callback route', { functionName, authenticated, legacy });
  return true;
}
