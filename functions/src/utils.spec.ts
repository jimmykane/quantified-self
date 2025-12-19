import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    generateIDFromParts,
    generateIDFromPartsOld,
    isCorsAllowed,
    determineRedirectURI,
} from './utils';

describe('utils', () => {
    describe('generateIDFromParts', () => {
        it('should generate a consistent hash for the same inputs', () => {
            const result1 = generateIDFromParts(['user123', 'workout456']);
            const result2 = generateIDFromParts(['user123', 'workout456']);
            expect(result1).toBe(result2);
        });

        it('should generate different hashes for different inputs', () => {
            const result1 = generateIDFromParts(['user123', 'workout456']);
            const result2 = generateIDFromParts(['user123', 'workout789']);
            expect(result1).not.toBe(result2);
        });

        it('should generate a hex string', () => {
            const result = generateIDFromParts(['test', 'value']);
            expect(result).toMatch(/^[a-f0-9]+$/);
        });

        it('should handle empty parts array', () => {
            const result = generateIDFromParts([]);
            expect(result).toBeTruthy();
            expect(typeof result).toBe('string');
        });

        it('should handle single part', () => {
            const result = generateIDFromParts(['singlepart']);
            expect(result).toBeTruthy();
        });

        it('should produce different results for different order', () => {
            const result1 = generateIDFromParts(['a', 'b']);
            const result2 = generateIDFromParts(['b', 'a']);
            expect(result1).not.toBe(result2);
        });
    });

    describe('generateIDFromPartsOld', () => {
        it('should generate a consistent base58 encoding for the same inputs', () => {
            const result1 = generateIDFromPartsOld(['user123', 'workout456']);
            const result2 = generateIDFromPartsOld(['user123', 'workout456']);
            expect(result1).toBe(result2);
        });

        it('should generate different results for different inputs', () => {
            const result1 = generateIDFromPartsOld(['user123', 'workout456']);
            const result2 = generateIDFromPartsOld(['user123', 'workout789']);
            expect(result1).not.toBe(result2);
        });

        it('should generate a base58 string (no 0, O, I, l characters)', () => {
            const result = generateIDFromPartsOld(['test', 'value']);
            expect(result).toMatch(/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/);
        });
    });

    describe('isCorsAllowed', () => {
        it('should allow localhost:4200', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue('http://localhost:4200'),
            } as any;
            expect(isCorsAllowed(mockReq)).toBe(true);
        });

        it('should allow quantified-self.io', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue('https://quantified-self.io'),
            } as any;
            expect(isCorsAllowed(mockReq)).toBe(true);
        });

        it('should allow beta.quantified-self.io', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue('https://beta.quantified-self.io'),
            } as any;
            expect(isCorsAllowed(mockReq)).toBe(true);
        });

        it('should deny unknown origins', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue('https://malicious-site.com'),
            } as any;
            expect(isCorsAllowed(mockReq)).toBe(false);
        });

        it('should deny undefined origin', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue(undefined),
            } as any;
            expect(isCorsAllowed(mockReq)).toBe(false);
        });
    });

    describe('determineRedirectURI', () => {
        it('should extract redirect_uri from query params', () => {
            const mockReq = {
                query: {
                    redirect_uri: 'https://quantified-self.io/callback',
                },
            } as any;
            expect(determineRedirectURI(mockReq)).toBe('https://quantified-self.io/callback');
        });

        it('should handle missing redirect_uri', () => {
            const mockReq = {
                query: {},
            } as any;
            // Should return 'undefined' as a string since it uses String()
            expect(determineRedirectURI(mockReq)).toBe('undefined');
        });
    });

    describe('Role-Based Limits', () => {
        // Use vi.hoisted to create mocks that can be referenced in vi.mock
        const { mockGetUser, mockCollection, mockCountGet } = vi.hoisted(() => {
            return {
                mockGetUser: vi.fn(),
                mockCollection: vi.fn(),
                mockCountGet: vi.fn()
            };
        });

        // Mock firebase-admin
        vi.mock('firebase-admin', () => ({
            auth: () => ({
                getUser: mockGetUser
            }),
            firestore: () => ({
                collection: mockCollection
            })
        }));

        const mockDoc = vi.fn();

        beforeEach(async () => {
            vi.clearAllMocks();

            // Setup Firestore Chain
            mockCountGet.mockResolvedValue({ data: () => ({ count: 0 }) });
            const mockCount = vi.fn().mockReturnValue({ get: mockCountGet });
            const mockEventCollection = { count: mockCount };

            mockDoc.mockReturnValue({ collection: vi.fn().mockReturnValue(mockEventCollection) });
            mockCollection.mockReturnValue({ doc: mockDoc });
        });

        // We need to re-import the module to apply the mock
        async function getUtils() {
            return await import('./utils');
        }

        describe('checkEventUsageLimit', () => {
            it('should allow pro users unlimited events', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'pro' } });
                const { checkEventUsageLimit } = await getUtils();

                await expect(checkEventUsageLimit('user1')).resolves.not.toThrow();
                // Should not even check count for pro
                expect(mockCollection).not.toHaveBeenCalled();
            });

            it('should enforce limit of 10 for free users', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
                const { checkEventUsageLimit, UsageLimitExceededError } = await getUtils();

                // Case: Under Limit (9)
                mockCountGet.mockResolvedValueOnce({ data: () => ({ count: 9 }) });
                await expect(checkEventUsageLimit('user1')).resolves.not.toThrow();

                // Case: Over Limit (10)
                mockCountGet.mockResolvedValueOnce({ data: () => ({ count: 10 }) });
                await expect(checkEventUsageLimit('user1')).rejects.toThrow();
            });

            it('should enforce limit of 100 for basic users', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'basic' } });
                const { checkEventUsageLimit, UsageLimitExceededError } = await getUtils();

                // Case: Under Limit (99)
                mockCountGet.mockResolvedValueOnce({ data: () => ({ count: 99 }) });
                await expect(checkEventUsageLimit('user1')).resolves.not.toThrow();

                // Case: Over Limit (100)
                mockCountGet.mockResolvedValueOnce({ data: () => ({ count: 100 }) });
                await expect(checkEventUsageLimit('user1')).rejects.toThrow();
            });

            it('should iterate over users/uid/events', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
                const { checkEventUsageLimit } = await getUtils();

                await tryCatch(() => checkEventUsageLimit('user123'));

                expect(mockCollection).toHaveBeenCalledWith('users');
                expect(mockDoc).toHaveBeenCalledWith('user123');
                // The second collection call on the docRef
                // We mocked: collection('users').doc('uid').collection('events')
                // mockDoc returns object with .collection()
                const docObj = mockDoc.mock.results[0].value;
                expect(docObj.collection).toHaveBeenCalledWith('events');
            });
        });

        describe('assertProServiceAccess', () => {
            it('should allow pro users', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'pro' } });
                const { assertProServiceAccess } = await getUtils();
                await expect(assertProServiceAccess('user1')).resolves.not.toThrow();
            });

            it('should verify reject free users', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
                const { assertProServiceAccess } = await getUtils();
                await expect(assertProServiceAccess('user1')).rejects.toThrow('Service sync is a Pro feature');
            });

            it('should reject basic users', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'basic' } });
                const { assertProServiceAccess } = await getUtils();
                await expect(assertProServiceAccess('user1')).rejects.toThrow('Service sync is a Pro feature');
            });
        });
    });
});

async function tryCatch(fn: () => Promise<any>) {
    try { await fn(); } catch (e) {
        // ignore error
        void e;
    }
}
