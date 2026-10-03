import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import * as logger from 'firebase-functions/logger';
import { SECRET_PARAMS } from '../secrets';

const SECRET_PATTERN = /^[a-f0-9]{64}$/;

function readCredential(): string | null {
  const value = SECRET_PARAMS.GARMINAPI_WEBHOOK_SECRET.value();
  return value.length === 64 && SECRET_PATTERN.test(value) ? value : null;
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
  const credential = readCredential();
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
  const expectedPath = `/${credential}/API`;
  const authenticated = typeof path === 'string' && path.length <= 256
    && timingSafeEqual(
      createHash('sha256').update(path).digest(),
      createHash('sha256').update(expectedPath).digest(),
    );
  // Staged portal rollout only: #800 removes this exact bare-root compatibility.
  const legacy = path === '/';
  if (!authenticated && !legacy) {
    response.status(403).send('Forbidden');
    return false;
  }
  // Request URLs can contain the credential. Only log fixed route facts.
  logger.info('[GarminWebhook] Accepted callback route', { functionName, authenticated, legacy });
  return true;
}
