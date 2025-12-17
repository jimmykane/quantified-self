import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as admin from 'firebase-admin';


// Mock firebase-functions BEFORE imports
vi.mock('firebase-functions/v1', () => ({
    region: () => ({
        pubsub: {
            schedule: () => ({
                onRun: (handler: any) => handler
            })
        },
        https: {
            onRequest: () => { }
        }
    })
}));

const testEnv = { cleanup: () => { } };

// Import AFTER mocks
import { disconnectExpiredServices } from './cleanup';
import * as OAuth2 from '../OAuth2';
import * as GarminWrapper from '../garmin/auth/wrapper';
import { ServiceNames } from '@sports-alliance/sports-lib';

describe('disconnectExpiredServices', () => {
    let deauthorizeServiceSpy: any;
    let deauthorizeGarminSpy: any;
    let firestoreSpy: any;
    let querySpy: any;
    let getSpy: any;

    beforeEach(() => {
        // Spy on dependencies
        deauthorizeServiceSpy = vi.spyOn(OAuth2, 'deauthorizeServiceForUser').mockResolvedValue(undefined);
        deauthorizeGarminSpy = vi.spyOn(GarminWrapper, 'deauthorizeGarminHealthAPIForUser').mockResolvedValue(undefined);

        // Mock Firestore
        getSpy = vi.fn().mockResolvedValue({
            forEach: (callback: (doc: any) => void) => {
                const mockDoc = {
                    ref: {
                        parent: {
                            parent: { id: 'test-user-123' }
                        }
                    }
                };
                callback(mockDoc);
            }
        });

        querySpy = vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                get: getSpy
            })
        });

        // Mock admin.firestore()
        firestoreSpy = vi.spyOn(admin, 'firestore').mockReturnValue({
            collectionGroup: vi.fn().mockReturnValue({
                where: querySpy
            }),
            Timestamp: {
                fromDate: (date: Date) => date
            }
        } as any);

        // Handle the static property on the mocked function if needed, 
        // but simpler to just mock the return value's structure.
        // We touched admin.firestore above, so we need to ensure Timestamp exists if used directly.
        // In the code: admin.firestore.Timestamp.fromDate
        // The spy above makes admin.firestore() return an object. 
        // We also need admin.firestore.Timestamp to exist.
        (admin.firestore as any).Timestamp = {
            fromDate: (date: Date) => date
        };
    });

    afterEach(() => {
        testEnv.cleanup();
        vi.restoreAllMocks();
    });

    it('should query for expired subscriptions and disconnect services', async () => {
        // Since we mocked onRun to return the handler, disconnectExpiredServices IS the handler
        const wrapped = disconnectExpiredServices as any;

        await wrapped({});

        // Verify Query
        expect(firestoreSpy).toHaveBeenCalled();
        expect(querySpy).toHaveBeenCalledWith('status', 'in', ['canceled', 'unpaid', 'past_due']);

        // Verify Disconnection Calls
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('test-user-123', ServiceNames.SuuntoApp);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('test-user-123', ServiceNames.COROSAPI);
        expect(deauthorizeGarminSpy).toHaveBeenCalledWith('test-user-123');
    });
});
