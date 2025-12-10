import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Mock the utils module for generateIDFromParts
vi.mock('../utils', () => ({
    generateIDFromParts: vi.fn((parts: string[]) => parts.join('-')),
}));

// Import AFTER mocks are set up - Vitest hoists vi.mock calls
import {
    convertCOROSWorkoutsToQueueItems,
    getCOROSQueueItemFromWorkout,
} from './queue';

describe('coros/queue', () => {
    describe('getCOROSQueueItemFromWorkout', () => {
        it('should create a queue item with correct structure', () => {
            const result = getCOROSQueueItemFromWorkout(
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

        it('should generate an ID from openId, labelId, and fitUrl', () => {
            const result = getCOROSQueueItemFromWorkout(
                'open-id-123',
                'label-456',
                'https://coros.com/fit/file.fit'
            );

            // With our mock, the ID should be the parts joined by -
            expect(result.id).toBe('open-id-123-label-456-https://coros.com/fit/file.fit');
        });

        it('should set dateCreated to current timestamp', () => {
            const before = Date.now();
            const result = getCOROSQueueItemFromWorkout('a', 'b', 'c');
            const after = Date.now();

            expect(result.dateCreated).toBeGreaterThanOrEqual(before);
            expect(result.dateCreated).toBeLessThanOrEqual(after);
        });
    });

    describe('convertCOROSWorkoutsToQueueItems', () => {
        it('should convert regular workouts to queue items', () => {
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

            const result = convertCOROSWorkoutsToQueueItems(workouts);

            expect(result).toHaveLength(2);
            expect(result[0].workoutID).toBe('workout1');
            expect(result[1].workoutID).toBe('workout2');
        });

        it('should use provided openId when available', () => {
            const workouts = [
                {
                    openId: 'originalUser',
                    labelId: 'workout1',
                    fitUrl: 'https://coros.com/fit/1.fit',
                },
            ];

            const result = convertCOROSWorkoutsToQueueItems(workouts, 'overrideUser');

            expect(result[0].openId).toBe('overrideUser');
        });

        it('should expand triathlon workouts into individual items', () => {
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

            const result = convertCOROSWorkoutsToQueueItems(workouts);

            expect(result).toHaveLength(3);
            expect(result[0].FITFileURI).toBe('https://coros.com/fit/swim.fit');
            expect(result[1].FITFileURI).toBe('https://coros.com/fit/bike.fit');
            expect(result[2].FITFileURI).toBe('https://coros.com/fit/run.fit');
        });

        it('should filter out workouts without FIT URL', () => {
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

            const result = convertCOROSWorkoutsToQueueItems(workouts);

            expect(result).toHaveLength(1);
            expect(result[0].workoutID).toBe('workout1');
        });

        it('should handle mixed regular and triathlon workouts', () => {
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

            const result = convertCOROSWorkoutsToQueueItems(workouts);

            expect(result).toHaveLength(3);
        });

        it('should handle empty workouts array', () => {
            const result = convertCOROSWorkoutsToQueueItems([]);
            expect(result).toHaveLength(0);
        });
    });
});
