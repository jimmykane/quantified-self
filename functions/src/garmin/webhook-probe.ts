import { onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';
import * as logger from 'firebase-functions/logger';

// Public, disposable URL markers, not credentials or sender authentication.
const PATH_MARKER = '/qs-path-marker-20261002';
const QUERY_MARKER = 'qs-query-marker-20261002';

export function handleGarminWebhookProbe(request: Request, response: Response): void {
  response.set('Cache-Control', 'no-store');
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.set('Allow', 'GET, POST').status(405).send('Method not allowed');
    return;
  }

  const pathMatches = request.path === PATH_MARKER
    || request.path === `/garminWebhookProbe${PATH_MARKER}`;
  let queryMatches = false;
  try {
    const values = new URL(request.url, 'https://probe.invalid').searchParams.getAll('probe');
    queryMatches = values.length === 1 && values[0] === QUERY_MARKER;
  } catch {
    // A malformed URL is still acknowledged; never log untrusted URL text.
  }

  if (request.method === 'POST') {
    logger.info('[GarminWebhookProbe] URL markers received', {
      pathMatches,
      queryMatches,
      manualTest: request.get('x-qs-probe-test') === 'manual',
      garminClientIdPresent: Boolean(request.get('garmin-client-id')),
    });
  }

  // Do not access body/rawBody, resolve users, follow callbacks, or enqueue work.
  response.status(200).send('OK');
}

export const garminWebhookProbe = onRequest({
  region: 'europe-west2',
  memory: '256MiB',
  cpu: 'gcf_gen1',
  concurrency: 1,
  minInstances: 0,
  maxInstances: 1,
  timeoutSeconds: 10,
  invoker: 'public',
  cors: false,
}, handleGarminWebhookProbe);
