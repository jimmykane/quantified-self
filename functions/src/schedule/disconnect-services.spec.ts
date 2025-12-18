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
import { GARMIN_HEALTH_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';

describe('disconnectServicesForNonPremium', () => {
    let deauthorizeServiceSpy: any;
    let deauthorizeGarminSpy: any;
    let firestoreSpy: any;
    let collectionSpy: any;

    beforeEach(() => {
        // Spy on dependencies
        deauthorizeServiceSpy = vi.spyOn(OAuth2, 'deauthorizeServiceForUser').mockResolvedValue(undefined);
        deauthorizeGarminSpy = vi.spyOn(GarminWrapper, 'deauthorizeGarminHealthAPIForUser').mockResolvedValue(undefined);

        // Mock Firestore Docs
        const createMockDoc = (id: string) => ({
            id,
            ref: { parent: { parent: { id } } }
        });

        // Mock Collection Queries
        const mockQuery = (docs: any[]) => ({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                empty: docs.length === 0,
                docs: docs,
                forEach: (cb: any) => docs.forEach(cb)
            })
        });

        collectionSpy = vi.fn();

        // Default mock implementation for collections
        // We will override this in tests to simulate finding users in specific token collections
        collectionSpy.mockImplementation((path: string) => {
            if (path === GARMIN_HEALTH_API_TOKENS_COLLECTION_NAME) return mockQuery([createMockDoc('garminUser')]);
            if (path === 'suuntoAppAccessTokens') return mockQuery([createMockDoc('suuntoUser')]);
            if (path === 'COROSAPIAccessTokens') return mockQuery([createMockDoc('corosUser')]);
            if (path.includes('subscriptions')) return mockQuery([]); // Default to no active sub
            return mockQuery([]);
        });

        // Mock admin.firestore()
        firestoreSpy = vi.spyOn(admin, 'firestore').mockReturnValue({
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

    it('should iterate all token collections and disconnect if NO premium', async () => {
        // Mock active premium sub check to return EMPTY for all users
        collectionSpy.mockImplementation((path: string) => {
            if (path === GARMIN_HEALTH_API_TOKENS_COLLECTION_NAME) return { get: vi.fn().mockResolvedValue({ forEach: (cb: any) => cb({ id: 'garminUser' }) }) };
            if (path === 'suuntoAppAccessTokens') return { get: vi.fn().mockResolvedValue({ forEach: (cb: any) => cb({ id: 'suuntoUser' }) }) };
            if (path === 'COROSAPIAccessTokens') return { get: vi.fn().mockResolvedValue({ forEach: (cb: any) => cb({ id: 'corosUser' }) }) };

            // Subscriptions check returns empty
            return {
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                get: vi.fn().mockResolvedValue({ empty: true, forEach: () => { } })
            };
        });

        const wrapped = disconnectServicesForNonPremium as any;
        await wrapped({});

        // Expect disconnection calls for all 3 found users
        expect(deauthorizeGarminSpy).toHaveBeenCalledWith('garminUser');
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('suuntoUser', ServiceNames.SuuntoApp);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('corosUser', ServiceNames.COROSAPI);
    });

    it('should NOT disconnect if user has active premium', async () => {
        // Mock active premium sub check to return FOUND for 'garminUser'
        collectionSpy.mockImplementation((path: string) => {
            if (path === GARMIN_HEALTH_API_TOKENS_COLLECTION_NAME) return { get: vi.fn().mockResolvedValue({ forEach: (cb: any) => cb({ id: 'garminUser' }) }) };
            if (path === 'suuntoAppAccessTokens') return { get: vi.fn().mockResolvedValue({ forEach: (cb: any) => [] }) };
            if (path === 'COROSAPIAccessTokens') return { get: vi.fn().mockResolvedValue({ forEach: (cb: any) => [] }) };

            // Subscriptions check returns NOT EMPTY (active sub)
            return {
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                get: vi.fn().mockResolvedValue({ empty: false, forEach: () => { } })
            };
        });

        const wrapped = disconnectServicesForNonPremium as any;
        await wrapped({});

        // Expect NO disconnection calls for garminUser
        expect(deauthorizeGarminSpy).not.toHaveBeenCalledWith('garminUser');
    });
});
