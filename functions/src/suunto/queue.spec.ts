import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  addToQueueForSuunto: vi.fn(),
}));

vi.mock('firebase-functions/v1', () => ({
  region: () => ({
    runWith: () => ({
      https: {
        onRequest: (handler: unknown) => handler,
      },
    }),
  }),
}));

vi.mock('firebase-functions/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../queue', () => ({
  addToQueueForSuunto: hoisted.addToQueueForSuunto,
}));

import * as logger from 'firebase-functions/logger';
import { insertSuuntoAppActivityToQueue } from './queue';

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

function createRequest(params: {
  body?: unknown;
  query?: Record<string, unknown>;
  rawBody?: Buffer;
  headers?: Record<string, string | undefined>;
}) {
  const normalizedHeaders = Object.entries(params.headers || {}).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value !== undefined) {
      acc[key.toLowerCase()] = value;
    }
    return acc;
  }, {});

  return {
    body: params.body || {},
    query: params.query || {},
    rawBody: params.rawBody,
    headers: normalizedHeaders,
    get: vi.fn((headerName: string) => normalizedHeaders[headerName.toLowerCase()]),
  };
}

function createSignedJsonRequest(body: unknown, signatureOverride?: string | null) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = signatureOverride === undefined
    ? createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '').update(rawBody).digest('hex')
    : signatureOverride || undefined;

  return createRequest({
    body,
    rawBody,
    headers: {
      'Content-Type': 'application/json',
      'X-HMAC-SHA256-Signature': signature,
    },
  });
}

function legacyAuthorizationHeader(): string {
  return `Basic ${Buffer.from(`${process.env.SUUNTOAPP_CLIENT_ID}:${process.env.SUUNTOAPP_CLIENT_SECRET}`).toString('base64')}`;
}

describe('insertSuuntoAppActivityToQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUUNTOAPP_CLIENT_ID = 'test-suunto-client-id';
    process.env.SUUNTOAPP_CLIENT_SECRET = 'test-suunto-client-secret';
    process.env.SUUNTOAPP_NOTIFICATION_SECRET = 'suunto-notification-secret';
    hoisted.addToQueueForSuunto.mockResolvedValue({ id: 'queue-id' });
  });

  it('queues valid JSON WORKOUT_CREATED notifications', async () => {
    const response = createResponse();
    const request = createSignedJsonRequest({
      type: 'WORKOUT_CREATED',
      username: 'johndoe123',
      workout: {
        workoutKey: '67604889401b942184624cb8',
      },
    });

    await insertSuuntoAppActivityToQueue(request as any, response as any);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(logger.info).toHaveBeenCalledWith('Suunto workout webhook routed', {
      format: 'json_hmac',
      notificationType: 'WORKOUT_CREATED',
    });
    expect(hoisted.addToQueueForSuunto).toHaveBeenCalledWith({
      userName: 'johndoe123',
      workoutID: '67604889401b942184624cb8',
    });
  });

  it.each([
    ['invalid', 'bad-signature'],
    ['missing', null],
  ])('rejects JSON workout notifications with %s HMAC signatures', async (_caseName, signature) => {
    const response = createResponse();
    const request = createSignedJsonRequest({
      type: 'WORKOUT_CREATED',
      username: 'johndoe123',
      workout: {
        workoutKey: '67604889401b942184624cb8',
      },
    }, signature);

    await insertSuuntoAppActivityToQueue(request as any, response as any);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(hoisted.addToQueueForSuunto).not.toHaveBeenCalled();
  });

  it('acknowledges signed non-workout JSON notifications without queueing', async () => {
    const response = createResponse();
    const request = createSignedJsonRequest({
      type: 'SUUNTO_247_SLEEP_CREATED',
      username: 'johndoe123',
      samples: [],
    });

    await insertSuuntoAppActivityToQueue(request as any, response as any);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(logger.info).toHaveBeenCalledWith('Ignoring non-workout Suunto JSON notification', {
      format: 'json_hmac',
      notificationType: 'SUUNTO_247_SLEEP_CREATED',
    });
    expect(hoisted.addToQueueForSuunto).not.toHaveBeenCalled();
  });

  it.each([
    ['username', { type: 'WORKOUT_CREATED', workout: { workoutKey: 'workout-1' } }],
    ['workout key', { type: 'WORKOUT_CREATED', username: 'johndoe123', workout: {} }],
  ])('returns 400 for signed workout JSON missing %s', async (_fieldName, body) => {
    const response = createResponse();
    const request = createSignedJsonRequest(body);

    await insertSuuntoAppActivityToQueue(request as any, response as any);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(hoisted.addToQueueForSuunto).not.toHaveBeenCalled();
  });

  it('keeps accepting legacy Basic form notifications', async () => {
    const response = createResponse();
    const request = createRequest({
      body: {
        username: 'legacy-user',
        workoutid: 'legacy-workout',
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: legacyAuthorizationHeader(),
      },
    });

    await insertSuuntoAppActivityToQueue(request as any, response as any);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(logger.info).toHaveBeenCalledWith('Suunto workout webhook routed', {
      format: 'legacy_basic',
    });
    expect(hoisted.addToQueueForSuunto).toHaveBeenCalledWith({
      userName: 'legacy-user',
      workoutID: 'legacy-workout',
    });
  });

  it('routes typed legacy Basic form notifications through legacy auth', async () => {
    const response = createResponse();
    const request = createRequest({
      body: {
        type: 'WORKOUT_CREATED',
        username: 'legacy-user',
        workoutid: 'legacy-workout',
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: legacyAuthorizationHeader(),
      },
    });

    await insertSuuntoAppActivityToQueue(request as any, response as any);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(hoisted.addToQueueForSuunto).toHaveBeenCalledWith({
      userName: 'legacy-user',
      workoutID: 'legacy-workout',
    });
  });

  it('returns 500 when JSON workout queue insertion fails', async () => {
    hoisted.addToQueueForSuunto.mockRejectedValueOnce(new Error('queue failed'));
    const response = createResponse();
    const request = createSignedJsonRequest({
      type: 'WORKOUT_CREATED',
      username: 'johndoe123',
      workout: {
        workoutKey: '67604889401b942184624cb8',
      },
    });

    await insertSuuntoAppActivityToQueue(request as any, response as any);

    expect(response.status).toHaveBeenCalledWith(500);
  });

  it('acknowledges JSON workout notifications without queueing retries when no local token is connected', async () => {
    const notConnectedError = Object.assign(new Error('not connected'), {
      name: 'ProviderQueueUserNotConnectedError',
    });
    hoisted.addToQueueForSuunto.mockRejectedValueOnce(notConnectedError);
    const response = createResponse();
    const request = createSignedJsonRequest({
      type: 'WORKOUT_CREATED',
      username: 'orphan-user',
      workout: {
        workoutKey: '67604889401b942184624cb8',
      },
    });

    await insertSuuntoAppActivityToQueue(request as any, response as any);

    expect(response.status).toHaveBeenCalledWith(200);
  });
});
