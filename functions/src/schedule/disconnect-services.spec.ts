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
import { disconnectServicesForNonPremium } from './disconnect-services';
import * as OAuth2 from '../OAuth2';
import * as GarminWrapper from '../garmin/auth/wrapper';
import { ServiceNames } from '@sports-alliance/sports-lib';

describe('disconnectServicesForNonPremium', () => {
    let deauthorizeServiceSpy: any;
    let deauthorizeGarminSpy: any;
    let firestoreSpy: any;
    let collectionGroupSpy: any;
    let collectionSpy: any;

    beforeEach(() => {
        // Spy on dependencies
        deauthorizeServiceSpy = vi.spyOn(OAuth2, 'deauthorizeServiceForUser').mockResolvedValue(undefined);
        deauthorizeGarminSpy = vi.spyOn(GarminWrapper, 'deauthorizeGarminHealthAPIForUser').mockResolvedValue(undefined);

        // Mock Firestore Docs
        const createMockDoc = (id: string, data: any) => ({
            id,
            data: () => data,
            ref: { parent: { parent: { id: 'test-user-123' } } }
        });

        // Mock Collection Queries
        const mockQuery = (docs: any[]) => ({
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                empty: docs.length === 0,
                docs: docs,
                forEach: (cb: any) => docs.forEach(cb)
            })
        });

        collectionGroupSpy = vi.fn().mockReturnValue(mockQuery([createMockDoc('sub1', {})]));
        collectionSpy = vi.fn();

        // Mock admin.firestore()
        firestoreSpy = vi.spyOn(admin, 'firestore').mockReturnValue({
            collectionGroup: collectionGroupSpy,
            collection: collectionSpy,
            Timestamp: {
                fromDate: (date: Date) => date
            }
        } as any);

        (admin.firestore as any).Timestamp = {
            fromDate: (date: Date) => date
        };
    });

    afterEach(() => {
        testEnv.cleanup();
        vi.restoreAllMocks();
    });

    it('should disconnect services if user has NO active premium subscription', async () => {
        // Mock active premium sub check to return EMPTY
        collectionSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ empty: true })
        });

        const wrapped = disconnectServicesForNonPremium as any;
        await wrapped({});

        // Verify active sub check was made
        expect(collectionSpy).toHaveBeenCalledWith('customers/test-user-123/subscriptions');

        // Verify Disconnection Calls MATCHED
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('test-user-123', ServiceNames.SuuntoApp);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('test-user-123', ServiceNames.COROSAPI);
        expect(deauthorizeGarminSpy).toHaveBeenCalledWith('test-user-123');
    });

    it('should NOT disconnect services if user HAS active premium subscription', async () => {
        // Mock active premium sub check to return A DOC (not empty)
        collectionSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ empty: false })
        });

        const wrapped = disconnectServicesForNonPremium as any;
        await wrapped({});

        // Verify active sub check was made
        expect(collectionSpy).toHaveBeenCalledWith('customers/test-user-123/subscriptions');

        // Verify Disconnection Calls did NOT happen
        expect(deauthorizeServiceSpy).not.toHaveBeenCalled();
        expect(deauthorizeGarminSpy).not.toHaveBeenCalled();
    });
});
