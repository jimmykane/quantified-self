import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    mockAddToQueueForCOROS,
} = vi.hoisted(() => ({
    mockAddToQueueForCOROS: vi.fn(),
}));

// Mock firebase-functions first (needed by auth modules at load time)
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
        https: { onRequest: () => { } },
        runWith: () => ({
            https: { onRequest: () => { } },
            pubsub: { schedule: () => ({ onRun: () => { } }) },
        }),
    }),
}));

// Mock simple-oauth2 - this must come before coros/auth/auth is loaded
vi.mock('simple-oauth2', () => ({
    AuthorizationCode: class {
        authorizeURL() {
            return 'https://mock-auth-url.com';
        }
        getToken() {
            return Promise.resolve({ token: {} });
        }
        createToken(token: any) {
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

// Mock the utils module for generateIDFromParts
vi.mock('../utils', () => ({
    generateIDFromParts: vi.fn((parts: string[]) => Promise.resolve(parts.join('-'))),
}));

// Import AFTER mocks are set up - Vitest hoists vi.mock calls
import {
    convertCOROSWorkoutsToQueueItems,
    getCOROSQueueItemFromWorkout,
    insertCOROSAPIWorkoutDataToQueue,
} from './queue';
import * as logger from 'firebase-functions/logger';

describe('coros/queue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.COROSAPI_CLIENT_ID = 'test-coros-client-id';
        process.env.COROSAPI_CLIENT_SECRET = 'test-coros-client-secret';
        mockAddToQueueForCOROS.mockResolvedValue({ id: 'queue-id' });
    });

    describe('getCOROSQueueItemFromWorkout', () => {
        it('should create a queue item with correct structure', async () => {
            const result = await getCOROSQueueItemFromWorkout(
                'open-id-123',
                'label-456',
                'https://coros.com/fit/file.fit'
            );

            expect(result).toMatchObject({
                openId: 'open-id-123',
                workoutID: 'label-456',
                FITFileURI: 'https://coros.com/fit/file.fit',
                retryCount: 0,
                processed: false,
            });
        });

        it('should generate an ID from openId, labelId, and fitUrl', async () => {
            const result = await getCOROSQueueItemFromWorkout(
                'open-id-123',
                'label-456',
                'https://coros.com/fit/file.fit'
            );

            // With our mock, the ID should be the parts joined by -
            expect(result.id).toBe('open-id-123-label-456-https://coros.com/fit/file.fit');
        });

        it('should set dateCreated to current timestamp', async () => {
            const before = Date.now();
            const result = await getCOROSQueueItemFromWorkout('a', 'b', 'c');
            const after = Date.now();

            expect(result.dateCreated).toBeGreaterThanOrEqual(before);
            expect(result.dateCreated).toBeLessThanOrEqual(after);
        });
    });

    describe('convertCOROSWorkoutsToQueueItems', () => {
        it('should convert regular workouts to queue items', async () => {
            const workouts = [
                {
                    openId: 'user1',
                    labelId: 'workout1',
                    fitUrl: 'https://coros.com/fit/1.fit',
                },
                {
                    openId: 'user1',
                    labelId: 'workout2',
                    fitUrl: 'https://coros.com/fit/2.fit',
                },
            ];

            const result = await convertCOROSWorkoutsToQueueItems(workouts);

            expect(result).toHaveLength(2);
            expect(result[0].workoutID).toBe('workout1');
            expect(result[1].workoutID).toBe('workout2');
        });

        it('should use provided openId when available', async () => {
            const workouts = [
                {
                    openId: 'originalUser',
                    labelId: 'workout1',
                    fitUrl: 'https://coros.com/fit/1.fit',
                },
            ];

            const result = await convertCOROSWorkoutsToQueueItems(workouts, 'overrideUser');

            expect(result[0].openId).toBe('overrideUser');
        });

        it('should expand triathlon workouts into individual items', async () => {
            const workouts = [
                {
                    openId: 'user1',
                    labelId: 'triathlon1',
                    triathlonItemList: [
                        { fitUrl: 'https://coros.com/fit/swim.fit' },
                        { fitUrl: 'https://coros.com/fit/bike.fit' },
                        { fitUrl: 'https://coros.com/fit/run.fit' },
                    ],
                },
            ];

            const result = await convertCOROSWorkoutsToQueueItems(workouts);

            expect(result).toHaveLength(3);
            expect(result[0].FITFileURI).toBe('https://coros.com/fit/swim.fit');
            expect(result[1].FITFileURI).toBe('https://coros.com/fit/bike.fit');
            expect(result[2].FITFileURI).toBe('https://coros.com/fit/run.fit');
        });

        it('should filter out workouts without FIT URL', async () => {
            const workouts = [
                {
                    openId: 'user1',
                    labelId: 'workout1',
                    fitUrl: 'https://coros.com/fit/1.fit',
                },
                {
                    openId: 'user1',
                    labelId: 'workout2',
                    fitUrl: undefined, // Missing FIT URL
                },
                {
                    openId: 'user1',
                    labelId: 'workout3',
                    fitUrl: '', // Empty FIT URL
                },
            ];

            const result = await convertCOROSWorkoutsToQueueItems(workouts);

            expect(result).toHaveLength(1);
            expect(result[0].workoutID).toBe('workout1');
        });

        it('should handle mixed regular and triathlon workouts', async () => {
            const workouts = [
                {
                    openId: 'user1',
                    labelId: 'regular1',
                    fitUrl: 'https://coros.com/fit/regular.fit',
                },
                {
                    openId: 'user1',
                    labelId: 'triathlon1',
                    triathlonItemList: [
                        { fitUrl: 'https://coros.com/fit/swim.fit' },
                        { fitUrl: 'https://coros.com/fit/bike.fit' },
                    ],
                },
            ];

            const result = await convertCOROSWorkoutsToQueueItems(workouts);

            expect(result).toHaveLength(3);
        });

        it('should handle empty workouts array', async () => {
            const result = await convertCOROSWorkoutsToQueueItems([]);
            expect(result).toHaveLength(0);
        });
    });

    describe('insertCOROSAPIWorkoutDataToQueue', () => {
        function createResponse() {
            return {
                status: vi.fn().mockReturnThis(),
                send: vi.fn().mockReturnThis(),
            };
        }

        function createRequest(body: unknown) {
            const headers: Record<string, string> = {
                client: 'test-coros-client-id',
                secret: 'test-coros-client-secret',
            };
            return {
                body,
                method: 'POST',
                get: vi.fn((headerName: string) => headers[headerName.toLowerCase()]),
            };
        }

        it.each([
            'ProviderQueueUserNotConnectedError',
            'ProviderQueueUserDeletedOrDeletingError',
        ])('acknowledges workout notifications for %s', async (errorName) => {
            mockAddToQueueForCOROS.mockRejectedValueOnce(Object.assign(new Error('not connected'), {
                name: errorName,
            }));
            const response = createResponse();
            const request = createRequest({
                sportDataList: [{
                    openId: 'orphan-open-id',
                    labelId: 'workout-1',
                    fitUrl: 'https://coros.com/fit/1.fit',
                }],
            });

            await insertCOROSAPIWorkoutDataToQueue(request as any, response as any);

            expect(response.status).toHaveBeenCalledWith(200);
            expect(mockAddToQueueForCOROS).toHaveBeenCalledTimes(1);
        });

        it('logs safe metadata instead of the raw COROS webhook payload', async () => {
            const response = createResponse();
            const requestBody = {
                sportDataList: [{
                    openId: 'open-id-sensitive-value',
                    labelId: 'workout-1',
                    fitUrl: 'https://coros.com/fit/sensitive.fit',
                }, {
                    openId: 'open-id-sensitive-value',
                    labelId: 'workout-2',
                    fitUrl: undefined,
                }],
            };
            const request = createRequest(requestBody);

            await insertCOROSAPIWorkoutDataToQueue(request as any, response as any);

            expect(response.status).toHaveBeenCalledWith(200);
            expect(logger.info).not.toHaveBeenCalledWith(JSON.stringify(requestBody));
            expect(logger.info).toHaveBeenCalledWith('COROS workout webhook received', expect.objectContaining({
                provider: 'COROS',
                sportDataCount: 2,
                providerUserIds: [expect.stringMatching(/^sha256:[a-f0-9]{12}$/)],
            }));
            expect(logger.info).toHaveBeenCalledWith('Insert to Queue for COROS success responding with ok', expect.objectContaining({
                provider: 'COROS',
                queuedCount: 1,
                skippedCount: 0,
                convertedQueueItemCount: 1,
                missingFitUrlCount: 1,
            }));
            const serializedLogs = [
                ...vi.mocked(logger.info).mock.calls,
                ...vi.mocked(logger.warn).mock.calls,
                ...vi.mocked(logger.error).mock.calls,
            ].map((call) => JSON.stringify(call)).join('\n');
            expect(serializedLogs).not.toContain('https://coros.com/fit/sensitive.fit');
            expect(serializedLogs).not.toContain('open-id-sensitive-value');
        });
    });
});
