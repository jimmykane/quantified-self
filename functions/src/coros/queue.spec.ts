import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAddToQueueForCOROS } = vi.hoisted(() => ({
  mockAddToQueueForCOROS: vi.fn(),
}));

vi.mock('firebase-functions', () => ({
  config: () => ({
    suuntoapp: {
      client_id: 'test-suunto-client-id',
      client_secret: 'test-suunto-client-secret',
      subscription_key: 'test-suunto-subscription-key',
    },
    corosapi: {
      client_id: 'test-coros-client-id',
      client_secret: 'test-coros-client-secret',
    },
    garminhealth: {
      consumer_key: 'test-garmin-consumer-key',
      consumer_secret: 'test-garmin-consumer-secret',
    },
  }),
  region: () => ({
    https: { onRequest: (handler: unknown) => handler },
    runWith: () => ({
      https: { onRequest: (handler: unknown) => handler },
      pubsub: { schedule: () => ({ onRun: (handler: unknown) => handler }) },
    }),
  }),
}));

vi.mock('simple-oauth2', () => ({
  AuthorizationCode: class {
    authorizeURL() { return 'https://mock-auth-url.com'; }
    getToken() { return Promise.resolve({ token: {} }); }
    createToken(token: unknown) {
      return { expired: () => false, refresh: () => Promise.resolve({ token: {} }), token };
    }
  },
}));

vi.mock('firebase-functions/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../queue', () => ({
  addToQueueForCOROS: mockAddToQueueForCOROS,
}));

vi.mock('../utils', () => ({
  generateIDFromParts: vi.fn((parts: string[]) => Promise.resolve(parts.join('-'))),
}));

import * as logger from 'firebase-functions/logger';
import {
  convertCOROSWorkoutsToQueueItems,
  getCOROSQueueItemFromWorkout,
  insertCOROSAPIWorkoutDataToQueue,
  InvalidCOROSWorkoutPayloadError,
} from './queue';

const regularWorkout = (overrides: Record<string, unknown> = {}) => ({
  openId: 'open-id-123',
  labelId: '418173315956375553',
  mode: 8,
  subMode: 1,
  fitUrl: 'https://oss.coros.com/fit/activity.fit',
  ...overrides,
});

describe('coros/queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COROSAPI_CLIENT_ID = 'test-coros-client-id';
    process.env.COROSAPI_CLIENT_SECRET = 'test-coros-client-secret';
    mockAddToQueueForCOROS.mockResolvedValue({ id: 'queue-id' });
  });

  describe('getCOROSQueueItemFromWorkout', () => {
    it('creates a stable root queue item independent of the signed FIT URL', async () => {
      const result = await getCOROSQueueItemFromWorkout(
        'open-id-123',
        '418173315956375553',
        'https://oss.coros.com/fit/activity.fit',
      );

      expect(result).toMatchObject({
        id: 'open-id-123-418173315956375553-root',
        openId: 'open-id-123',
        workoutID: '418173315956375553',
        FITFileURI: 'https://oss.coros.com/fit/activity.fit',
        mode: 0,
        subMode: 0,
        componentKey: 'root',
        retryCount: 0,
        processed: false,
        dispatchedToCloudTask: null,
      });
    });

    it('sets dateCreated to the current timestamp', async () => {
      const before = Date.now();
      const result = await getCOROSQueueItemFromWorkout('open-id', '418173315956375553');
      expect(result.dateCreated).toBeGreaterThanOrEqual(before);
      expect(result.dateCreated).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('convertCOROSWorkoutsToQueueItems', () => {
    it('preserves provider metadata on a regular workout', async () => {
      const [result] = await convertCOROSWorkoutsToQueueItems([regularWorkout({
        deviceName: 'COROS PACE 3',
        startTimezone: 8,
        endTimezone: 12,
        planWorkoutId: '9223372036854775807',
      })]);

      expect(result).toMatchObject({
        openId: 'open-id-123',
        workoutID: '418173315956375553',
        mode: 8,
        subMode: 1,
        detailMode: 8,
        detailSubMode: 1,
        deviceName: 'COROS PACE 3',
        startTimezone: 8,
        endTimezone: 12,
        planWorkoutId: '9223372036854775807',
        componentKey: 'root',
      });
    });

    it('uses a caller-pinned openId for history results', async () => {
      const [result] = await convertCOROSWorkoutsToQueueItems(
        [regularWorkout({ openId: 'untrusted-response-open-id' })],
        'pinned-open-id',
      );
      expect(result.openId).toBe('pinned-open-id');
    });

    it('expands multisport workouts and preserves the parent detail lookup type', async () => {
      const result = await convertCOROSWorkoutsToQueueItems([regularWorkout({
        mode: 13,
        subMode: 1,
        fitUrl: undefined,
        deviceName: 'COROS VERTIX',
        planWorkoutId: '443847671331979261',
        triathlonItemList: [
          { mode: 10, subMode: 1, fitUrl: 'https://oss.coros.com/fit/swim.fit' },
          { mode: 9, subMode: 1 },
          { mode: 8, subMode: 1, fitUrl: 'https://oss.coros.com/fit/run.fit' },
        ],
      })]);

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        mode: 10,
        subMode: 1,
        detailMode: 13,
        detailSubMode: 1,
        componentIndex: 0,
        componentKey: 'component:0:10:1',
        deviceName: 'COROS VERTIX',
        planWorkoutId: '443847671331979261',
      });
      expect(result[1]).toMatchObject({
        mode: 9,
        subMode: 1,
        componentIndex: 1,
        componentKey: 'component:1:9:1',
      });
      expect(result[1]).not.toHaveProperty('FITFileURI');
      expect(result[2].id).toBe('open-id-123-418173315956375553-component:2:8:1');
    });

    it('retains workouts without FIT URLs so detail recovery can process them', async () => {
      const result = await convertCOROSWorkoutsToQueueItems([
        regularWorkout(),
        regularWorkout({ labelId: '418173315956375554', fitUrl: undefined }),
        regularWorkout({ labelId: '418173315956375555', fitUrl: '' }),
      ]);

      expect(result).toHaveLength(3);
      expect(result.map(item => item.workoutID)).toEqual([
        '418173315956375553',
        '418173315956375554',
        '418173315956375555',
      ]);
      expect(result[1]).not.toHaveProperty('FITFileURI');
    });

    it('rejects unsafe numeric identifiers after JSON precision was already lost', async () => {
      await expect(convertCOROSWorkoutsToQueueItems([
        regularWorkout({ labelId: Number('418173315956375553') }),
      ])).rejects.toBeInstanceOf(InvalidCOROSWorkoutPayloadError);
    });

    it('rejects provider identifiers outside the signed 64-bit range', async () => {
      await expect(convertCOROSWorkoutsToQueueItems([
        regularWorkout({ labelId: '9223372036854775808' }),
      ])).rejects.toMatchObject({ reason: 'invalid_label_id' });
    });

    it('bounds per-workout and total multisport expansion', async () => {
      const components = Array.from({ length: 100 }, (_, index) => ({
        mode: 8,
        subMode: index % 2,
      }));
      await expect(convertCOROSWorkoutsToQueueItems([
        regularWorkout({ triathlonItemList: [...components, { mode: 8, subMode: 1 }] }),
      ])).rejects.toMatchObject({ reason: 'component_list_too_large' });

      await expect(convertCOROSWorkoutsToQueueItems(Array.from({ length: 11 }, (_, index) =>
        regularWorkout({
          labelId: `${418173315956375500n + BigInt(index)}`,
          triathlonItemList: components,
        })))).rejects.toMatchObject({ reason: 'expanded_workout_list_too_large' });
    });

    it('rejects multisport workouts without child components', async () => {
      await expect(convertCOROSWorkoutsToQueueItems([
        regularWorkout({ mode: 13, subMode: 1, fitUrl: undefined }),
      ])).rejects.toMatchObject({ reason: 'missing_multisport_components' });

      await expect(convertCOROSWorkoutsToQueueItems([
        regularWorkout({ mode: 13, subMode: 2, fitUrl: undefined, triathlonItemList: [] }),
      ])).rejects.toMatchObject({ reason: 'missing_multisport_components' });
    });

    it('handles an empty workout list', async () => {
      await expect(convertCOROSWorkoutsToQueueItems([])).resolves.toEqual([]);
    });
  });

  describe('insertCOROSAPIWorkoutDataToQueue', () => {
    function createResponse() {
      return {
        status: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };
    }

    function createRequest({
      body,
      method = 'POST',
      headers = {},
      rawBody,
    }: {
      body?: unknown;
      method?: string;
      headers?: Record<string, string>;
      rawBody?: Buffer;
    }) {
      const normalizedHeaders: Record<string, string> = {
        client: 'test-coros-client-id',
        secret: 'test-coros-client-secret',
        ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
      };
      return {
        body,
        method,
        rawBody,
        get: vi.fn((headerName: string) => normalizedHeaders[headerName.toLowerCase()]),
      };
    }

    it('acknowledges the unauthenticated GET health check', async () => {
      const response = createResponse();
      await insertCOROSAPIWorkoutDataToQueue(
        createRequest({ method: 'GET', headers: { client: '', secret: '' } }) as never,
        response as never,
      );
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.send).toHaveBeenCalledWith({ message: 'ok', result: '0000' });
      expect(mockAddToQueueForCOROS).not.toHaveBeenCalled();
    });

    it('rejects unsupported methods', async () => {
      const response = createResponse();
      await insertCOROSAPIWorkoutDataToQueue(createRequest({ method: 'PUT' }) as never, response as never);
      expect(response.set).toHaveBeenCalledWith('Allow', 'GET, POST');
      expect(response.status).toHaveBeenCalledWith(405);
      expect(response.send).toHaveBeenCalledWith(expect.objectContaining({ result: '1002' }));
    });

    it('returns a non-success result when POST credentials are missing or wrong', async () => {
      const response = createResponse();
      await insertCOROSAPIWorkoutDataToQueue(createRequest({
        body: { sportDataList: [regularWorkout()] },
        headers: { secret: 'wrong' },
      }) as never, response as never);
      expect(response.status).toHaveBeenCalledWith(401);
      expect(response.send).toHaveBeenCalledWith(expect.objectContaining({ result: '1001' }));
      expect(mockAddToQueueForCOROS).not.toHaveBeenCalled();
    });

    it('returns a non-success result for malformed or empty payloads', async () => {
      const response = createResponse();
      await insertCOROSAPIWorkoutDataToQueue(
        createRequest({ body: { sportDataList: [] } }) as never,
        response as never,
      );
      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.send).toHaveBeenCalledWith(expect.objectContaining({ result: '1002' }));
    });

    it('rejects a webhook whose multisport expansion exceeds the queue batch limit', async () => {
      const response = createResponse();
      const components = Array.from({ length: 100 }, () => ({ mode: 8, subMode: 1 }));
      await insertCOROSAPIWorkoutDataToQueue(createRequest({
        body: {
          sportDataList: Array.from({ length: 11 }, (_, index) => regularWorkout({
            labelId: `${418173315956375500n + BigInt(index)}`,
            triathlonItemList: components,
          })),
        },
      }) as never, response as never);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.send).toHaveBeenCalledWith(expect.objectContaining({ result: '1002' }));
      expect(mockAddToQueueForCOROS).not.toHaveBeenCalled();
    });

    it('preserves unquoted 64-bit COROS IDs from the raw request body', async () => {
      const response = createResponse();
      const rawBody = Buffer.from(JSON.stringify({
        sportDataList: [regularWorkout({
          labelId: '__LABEL_ID__',
          planWorkoutId: '__PLAN_ID__',
        })],
      }).replace('"__LABEL_ID__"', '418173315956375553')
        .replace('"__PLAN_ID__"', '443847671331979261'));

      await insertCOROSAPIWorkoutDataToQueue(
        createRequest({ body: {}, rawBody }) as never,
        response as never,
      );

      expect(response.status).toHaveBeenCalledWith(200);
      expect(mockAddToQueueForCOROS).toHaveBeenCalledWith(expect.objectContaining({
        workoutID: '418173315956375553',
        planWorkoutId: '443847671331979261',
      }));
    });

    it.each([
      'ProviderQueueUserNotConnectedError',
      'ProviderQueueUserDeletedOrDeletingError',
    ])('acknowledges non-retryable local skips for %s', async (errorName) => {
      mockAddToQueueForCOROS.mockRejectedValueOnce(Object.assign(new Error('not connected'), { name: errorName }));
      const response = createResponse();
      await insertCOROSAPIWorkoutDataToQueue(
        createRequest({ body: { sportDataList: [regularWorkout()] } }) as never,
        response as never,
      );
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.send).toHaveBeenCalledWith(expect.objectContaining({ result: '0000' }));
    });

    it('returns a retryable failure acknowledgement when queue persistence fails', async () => {
      mockAddToQueueForCOROS.mockRejectedValueOnce(new Error('firestore unavailable'));
      const response = createResponse();
      await insertCOROSAPIWorkoutDataToQueue(
        createRequest({ body: { sportDataList: [regularWorkout()] } }) as never,
        response as never,
      );
      expect(response.status).toHaveBeenCalledWith(503);
      expect(response.send).toHaveBeenCalledWith(expect.objectContaining({ result: '2001' }));
    });

    it('logs safe metadata and counts recoverable missing FIT URLs', async () => {
      const response = createResponse();
      const requestBody = {
        sportDataList: [
          regularWorkout({ fitUrl: 'https://oss.coros.com/fit/sensitive.fit' }),
          regularWorkout({ labelId: '418173315956375554', fitUrl: undefined }),
        ],
      };
      await insertCOROSAPIWorkoutDataToQueue(
        createRequest({ body: requestBody }) as never,
        response as never,
      );

      expect(response.status).toHaveBeenCalledWith(200);
      expect(logger.info).toHaveBeenCalledWith('COROS workout webhook received', expect.objectContaining({
        provider: 'COROS',
        sportDataCount: 2,
        providerUserIds: [expect.stringMatching(/^sha256:[a-f0-9]{12}$/)],
      }));
      expect(logger.info).toHaveBeenCalledWith(
        'Insert to Queue for COROS success responding with ok',
        expect.objectContaining({
          queuedCount: 2,
          skippedCount: 0,
          convertedQueueItemCount: 2,
          missingFitUrlCount: 1,
        }),
      );
      const serializedLogs = [
        ...vi.mocked(logger.info).mock.calls,
        ...vi.mocked(logger.warn).mock.calls,
        ...vi.mocked(logger.error).mock.calls,
      ].map(call => JSON.stringify(call)).join('\n');
      expect(serializedLogs).not.toContain('https://oss.coros.com/fit/sensitive.fit');
      expect(serializedLogs).not.toContain('open-id-123');
    });
  });
});
