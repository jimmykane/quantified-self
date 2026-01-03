import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { addToHistoryImportQueue, processHistoryImportRequest } from './history';
import * as utils from './utils';
import * as tokens from './tokens';
import * as requestHelper from './request-helper';
import { getServiceWorkoutQueueName } from './shared/queue-names';

// Mock Dependencies
vi.mock('firebase-admin', () => {
    const firestoreMock = {
        collection: vi.fn(),
        batch: vi.fn(),
    };
    return {
        firestore: vi.fn(() => firestoreMock),
    };
});

vi.mock('./utils', async (importOriginal) => {
    const actual = await importOriginal<typeof utils>();
    return {
        ...actual,
        generateIDFromParts: vi.fn().mockResolvedValue('mock-id'),
        enqueueWorkoutTask: vi.fn().mockResolvedValue(undefined),
    };
});

vi.mock('./tokens', () => ({
    getTokenData: vi.fn(),
}));

vi.mock('./request-helper', () => ({
    get: vi.fn(),
}));

vi.mock('./OAuth2', () => ({
    getServiceConfig: () => ({ tokenCollectionName: 'tokens-col' }),
}));

describe('History Import', () => {
    let firestoreMock: any;
    let collectionMock: any;
    let docMock: any;
    let batchMock: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup Firestore Mocks
        batchMock = {
            set: vi.fn(),
            commit: vi.fn().mockResolvedValue(true),
        };
        docMock = {
            set: vi.fn().mockResolvedValue(true),
            collection: vi.fn(), // for sub-collections ('tokens')
            get: vi.fn(),
        };
        collectionMock = {
            doc: vi.fn(() => docMock),
            get: vi.fn(),
        };

        firestoreMock = admin.firestore();
        firestoreMock.collection.mockReturnValue(collectionMock);
        firestoreMock.batch.mockReturnValue(batchMock);
    });

    describe('addToHistoryImportQueue', () => {
        it('should create an import_request item and dispatch a task (Suunto)', async () => {
            const userID = 'user123';
            const serviceName = ServiceNames.SuuntoApp;
            const startDate = new Date('2023-01-01T00:00:00Z');
            const endDate = new Date('2023-01-31T23:59:59Z');

            await addToHistoryImportQueue(userID, serviceName, startDate, endDate);

            // Verify Firestore Write to *HistoryImport* queue
            const queueName = getServiceWorkoutQueueName(serviceName, true); // true = history
            expect(firestoreMock.collection).toHaveBeenCalledWith(queueName);
            expect(docMock.set).toHaveBeenCalledWith(expect.objectContaining({
                type: 'import_request',
                userID,
                serviceName,
                startDate: startDate.getTime(),
                endDate: endDate.getTime(),
            }));

            // Verify Task Dispatch
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledWith(serviceName, 'mock-id');
        });
    });

    describe('processHistoryImportRequest', () => {
        it('should process workouts and enqueue them (Suunto)', async () => {
            const userID = 'user123';
            const serviceName = ServiceNames.SuuntoApp;
            const startDate = new Date('2023-01-01T00:00:00Z');
            const endDate = new Date('2023-01-31T23:59:59Z');

            // 2. Mock Tokens
            const mockTokenDoc = { id: 'token1' };
            const tokensQuerySnapshot = {
                size: 1,
                docs: [mockTokenDoc],
            };

            // We need a mock that supports both .get() (for tokens) and .doc() (for meta)
            // Recursive structure allow infinite depth if needed
            const subCollectionMock: any = {
                get: vi.fn().mockResolvedValue(tokensQuerySnapshot),
                doc: vi.fn(),
            };
            // Point .doc back to docMock so we can chain .collection again if needed, 
            // or just to be a valid "doc ref" object
            subCollectionMock.doc.mockReturnValue(docMock);

            docMock.collection.mockReturnValue(subCollectionMock);

            (tokens.getTokenData as any).mockResolvedValue({ accessToken: 'access-token' });

            // 2. Mock API Response for getWorkoutQueueItems (Suunto)
            // history.ts:168 checks `response.payload`
            (requestHelper.get as any).mockResolvedValue(JSON.stringify({
                payload: [
                    { workoutKey: 'w1', startTime: startDate.getTime() + 1000 },
                    { workoutKey: 'w2', startTime: startDate.getTime() + 2000 },
                ]
            }));

            await processHistoryImportRequest(userID, serviceName, startDate, endDate);

            // Verify API called
            expect(requestHelper.get).toHaveBeenCalled();

            // Verify Batch Writes
            // Should add w1 and w2 to queue as workout_items
            expect(batchMock.set).toHaveBeenCalledTimes(3);
            // Verify content of set
            const setCalls = batchMock.set.mock.calls;
            expect(setCalls[0][1]).toMatchObject({ workoutID: 'w1', processed: false });
            expect(setCalls[1][1]).toMatchObject({ workoutID: 'w2', processed: false });
            // Third call is meta update
            expect(setCalls[2][1]).toMatchObject({
                didLastHistoryImport: expect.any(Number),
                processedActivitiesFromLastHistoryImportCount: 2
            });

            expect(batchMock.commit).toHaveBeenCalledTimes(1);

            // Verify Enqueue Tasks
            // Should call enqueueWorkoutTask for w1 and w2 (with their IDs)
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledTimes(2);
        });

        it('should handle empty workout list gracefully', async () => {
            const userID = 'user123';
            const serviceName = ServiceNames.SuuntoApp;
            const startDate = new Date('2023-01-01');
            const endDate = new Date('2023-01-31');

            // Mock Token
            const subCollectionMock = {
                get: vi.fn().mockResolvedValue({ size: 1, docs: [{ id: 't1' }] }),
            };
            docMock.collection.mockReturnValue(subCollectionMock);
            (tokens.getTokenData as any).mockResolvedValue({ accessToken: 'abc' });

            // Mock Empty API Response
            (requestHelper.get as any).mockResolvedValue(JSON.stringify({ payload: [] }));

            await processHistoryImportRequest(userID, serviceName, startDate, endDate);

            // Verify NO batch writes
            expect(batchMock.set).not.toHaveBeenCalled();
            expect(batchMock.commit).not.toHaveBeenCalled();
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });
    });
});
