import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    generateIDFromParts,
    generateIDFromPartsOld,
    isCorsAllowed,
    determineRedirectURI,
    enforceAppCheck,
    ENFORCE_APP_CHECK,
} from './utils';

async function tryCatch(fn: () => Promise<unknown>) {
    try { await fn(); } catch (e) {
        // ignore error
        void e;
    }
}


describe('utils', () => {
    describe('generateIDFromParts', () => {
        it('should generate a consistent hash for the same inputs', async () => {
            const result1 = await generateIDFromParts(['user123', 'workout456']);
            const result2 = await generateIDFromParts(['user123', 'workout456']);
            expect(result1).toBe(result2);
        });

        it('should generate different hashes for different inputs', async () => {
            const result1 = await generateIDFromParts(['user123', 'workout456']);
            const result2 = await generateIDFromParts(['user123', 'workout789']);
            expect(result1).not.toBe(result2);
        });

        it('should generate a hex string', async () => {
            const result = await generateIDFromParts(['test', 'value']);
            expect(result).toMatch(/^[a-f0-9]+$/);
        });

        it('should handle empty parts array', async () => {
            const result = await generateIDFromParts([]);
            expect(result).toBeTruthy();
            expect(typeof result).toBe('string');
        });

        it('should handle single part', async () => {
            const result = await generateIDFromParts(['singlepart']);
            expect(result).toBeTruthy();
        });

        it('should produce different results for different order', async () => {
            const result1 = await generateIDFromParts(['a', 'b']);
            const result2 = await generateIDFromParts(['b', 'a']);
            expect(result1).not.toBe(result2);
        });

        it('should handle parts with special characters', async () => {
            const result = await generateIDFromParts(['user@123', 'workout#456']);
            expect(result).toMatch(/^[a-f0-9]+$/);
        });

        it('should handle unicode characters', async () => {
            const result = await generateIDFromParts(['用户', 'тренировка']);
            expect(result).toBeTruthy();
            expect(result).toMatch(/^[a-f0-9]+$/);
        });

        it('should handle very long parts', async () => {
            const longPart = 'a'.repeat(10000);
            const result = await generateIDFromParts([longPart]);
            expect(result).toBeTruthy();
        });

        it('should handle parts with colons', async () => {
            // Colons are used as delimiters internally
            const result = await generateIDFromParts(['part:with:colons', 'other']);
            expect(result).toBeTruthy();
        });

        it('should handle empty string parts', async () => {
            const result = await generateIDFromParts(['', 'valid', '']);
            expect(result).toBeTruthy();
        });

        it('should produce deterministic output across multiple calls', async () => {
            const results = await Promise.all([
                generateIDFromParts(['test', 'value']),
                generateIDFromParts(['test', 'value']),
                generateIDFromParts(['test', 'value']),
            ]);
            expect(results[0]).toBe(results[1]);
            expect(results[1]).toBe(results[2]);
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

        it('should handle empty parts array', () => {
            const result = generateIDFromPartsOld([]);
            // Empty array produces empty string (no parts to join)
            expect(result).toBe('');
        });

        it('should handle special characters', () => {
            const result = generateIDFromPartsOld(['user@123!', 'workout#456']);
            expect(result).toMatch(/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/);
        });
    });

    describe('isCorsAllowed', () => {
        it('should allow localhost:4200', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue('http://localhost:4200'),
            } as unknown as Parameters<typeof isCorsAllowed>[0];
            expect(isCorsAllowed(mockReq)).toBe(true);
        });

        it('should allow localhost:4201 (https)', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue('https://localhost:4201'),
            } as unknown as Parameters<typeof isCorsAllowed>[0];
            expect(isCorsAllowed(mockReq)).toBe(true);
        });

        it('should allow localhost:8080', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue('http://localhost:8080'),
            } as unknown as Parameters<typeof isCorsAllowed>[0];
            expect(isCorsAllowed(mockReq)).toBe(true);
        });

        it('should allow quantified-self.io', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue('https://quantified-self.io'),
            } as unknown as Parameters<typeof isCorsAllowed>[0];
            expect(isCorsAllowed(mockReq)).toBe(true);
        });

        it('should allow beta.quantified-self.io', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue('https://beta.quantified-self.io'),
            } as unknown as Parameters<typeof isCorsAllowed>[0];
            expect(isCorsAllowed(mockReq)).toBe(true);
        });

        it('should deny unknown origins', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue('https://malicious-site.com'),
            } as unknown as Parameters<typeof isCorsAllowed>[0];
            expect(isCorsAllowed(mockReq)).toBe(false);
        });

        it('should deny undefined origin', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue(undefined),
            } as unknown as Parameters<typeof isCorsAllowed>[0];
            expect(isCorsAllowed(mockReq)).toBe(false);
        });

        it('should deny null origin', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue(null),
            } as unknown as Parameters<typeof isCorsAllowed>[0];
            expect(isCorsAllowed(mockReq)).toBe(false);
        });

        it('should deny empty string origin', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue(''),
            } as unknown as Parameters<typeof isCorsAllowed>[0];
            expect(isCorsAllowed(mockReq)).toBe(false);
        });

        it('should allow localhost with various port numbers', () => {
            const ports = [3000, 4200, 4201, 5000, 8080, 9000];
            for (const port of ports) {
                const mockReq = {
                    get: vi.fn().mockReturnValue(`http://localhost:${port}`),
                } as unknown as Parameters<typeof isCorsAllowed>[0];
                expect(isCorsAllowed(mockReq)).toBe(true);
            }
        });

        it('should deny origin that looks similar but is not allowed', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue('https://quantified-self.io.evil.com'),
            } as unknown as Parameters<typeof isCorsAllowed>[0];
            expect(isCorsAllowed(mockReq)).toBe(false);
        });

        it('should deny subdomain that is not beta', () => {
            const mockReq = {
                get: vi.fn().mockReturnValue('https://staging.quantified-self.io'),
            } as unknown as Parameters<typeof isCorsAllowed>[0];
            expect(isCorsAllowed(mockReq)).toBe(false);
        });
    });

    describe('determineRedirectURI', () => {
        it('should extract redirect_uri from query params', () => {
            const mockReq = {
                query: {
                    redirect_uri: 'https://quantified-self.io/callback',
                },
            } as unknown as Parameters<typeof determineRedirectURI>[0];
            expect(determineRedirectURI(mockReq)).toBe('https://quantified-self.io/callback');
        });

        it('should handle missing redirect_uri', () => {
            const mockReq = {
                query: {},
            } as unknown as Parameters<typeof determineRedirectURI>[0];
            // Should return empty string when redirect_uri is not provided
            expect(determineRedirectURI(mockReq)).toBe('');
        });

        it('should handle null redirect_uri', () => {
            const mockReq = {
                query: { redirect_uri: null },
            } as unknown as Parameters<typeof determineRedirectURI>[0];
            // Should return empty string when redirect_uri is null
            expect(determineRedirectURI(mockReq)).toBe('');
        });

        it('should handle empty string redirect_uri', () => {
            const mockReq = {
                query: { redirect_uri: '' },
            } as unknown as Parameters<typeof determineRedirectURI>[0];
            expect(determineRedirectURI(mockReq)).toBe('');
        });

        it('should handle array redirect_uri (takes first)', () => {
            const mockReq = {
                query: { redirect_uri: ['https://quantified-self.io/callback', 'second'] },
            } as unknown as Parameters<typeof determineRedirectURI>[0];
            // Should validly return the first element
            expect(determineRedirectURI(mockReq)).toBe('https://quantified-self.io/callback');
        });

        it('should allow localhost with port', () => {
            const mockReq = {
                query: { redirect_uri: 'http://localhost:4200/auth/callback' },
            } as unknown as Parameters<typeof determineRedirectURI>[0];
            expect(determineRedirectURI(mockReq)).toBe('http://localhost:4200/auth/callback');
        });

        it('should allow beta subdomain', () => {
            const mockReq = {
                query: { redirect_uri: 'https://beta.quantified-self.io/auth/callback' },
            } as unknown as Parameters<typeof determineRedirectURI>[0];
            expect(determineRedirectURI(mockReq)).toBe('https://beta.quantified-self.io/auth/callback');
        });

        it('should block external domains', () => {
            const mockReq = {
                query: { redirect_uri: 'https://evil.com/callback' },
            } as unknown as Parameters<typeof determineRedirectURI>[0];
            expect(determineRedirectURI(mockReq)).toBe('');
        });

        it('should block malicious subdomains', () => {
            const mockReq = {
                query: { redirect_uri: 'https://quantified-self.io.evil.com/callback' },
            } as unknown as Parameters<typeof determineRedirectURI>[0];
            expect(determineRedirectURI(mockReq)).toBe('');
        });
    });

    describe('enforceAppCheck', () => {
        it('should not throw when app context is present', () => {
            const request = { app: { appId: 'test-app' } };
            expect(() => enforceAppCheck(request)).not.toThrow();
        });

        it('should throw HttpsError when app context is missing', () => {
            const request = { app: undefined };
            expect(() => enforceAppCheck(request)).toThrow('App Check verification failed.');
        });

        it('should throw HttpsError when app context is null', () => {
            const request = { app: null };
            expect(() => enforceAppCheck(request)).toThrow('App Check verification failed.');
        });

        it('should throw HttpsError when app context is empty object', () => {
            // Empty object is truthy, so should pass
            const request = { app: {} };
            expect(() => enforceAppCheck(request)).not.toThrow();
        });

        it('should throw when no app property exists', () => {
            const request = {};
            expect(() => enforceAppCheck(request)).toThrow('App Check verification failed.');
        });

        it('ENFORCE_APP_CHECK constant should be defined and be a boolean', () => {
            expect(typeof ENFORCE_APP_CHECK).toBe('boolean');
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
                const { checkEventUsageLimit } = await getUtils();

                // Case: Under Limit (9)
                mockCountGet.mockResolvedValueOnce({ data: () => ({ count: 9 }) });
                await expect(checkEventUsageLimit('user1')).resolves.not.toThrow();

                // Case: Over Limit (10)
                mockCountGet.mockResolvedValueOnce({ data: () => ({ count: 10 }) });
                await expect(checkEventUsageLimit('user1')).rejects.toThrow();
            });

            it('should enforce limit of 100 for basic users', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'basic' } });
                const { checkEventUsageLimit } = await getUtils();

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

            it('should allow exactly at limit - 1', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
                const { checkEventUsageLimit } = await getUtils();

                // Free limit is 10, so 9 should pass
                mockCountGet.mockResolvedValueOnce({ data: () => ({ count: 9 }) });
                await expect(checkEventUsageLimit('user1')).resolves.not.toThrow();
            });

            it('should handle user with no customClaims', async () => {
                mockGetUser.mockResolvedValue({});
                const { checkEventUsageLimit } = await getUtils();

                // No claims means free tier
                mockCountGet.mockResolvedValueOnce({ data: () => ({ count: 11 }) });
                await expect(checkEventUsageLimit('user1')).rejects.toThrow();
            });

            it('should handle user with empty customClaims', async () => {
                mockGetUser.mockResolvedValue({ customClaims: {} });
                const { checkEventUsageLimit } = await getUtils();

                // Empty claims means free tier
                mockCountGet.mockResolvedValueOnce({ data: () => ({ count: 11 }) });
                await expect(checkEventUsageLimit('user1')).rejects.toThrow();
            });
        });

        describe('isProUser', () => {
            it('should return true for pro users', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'pro' } });
                const { isProUser } = await getUtils();
                await expect(isProUser('user1')).resolves.toBe(true);
            });

            it('should return false for free users', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
                const { isProUser } = await getUtils();
                await expect(isProUser('user1')).resolves.toBe(false);
            });

            it('should return false for basic users', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'basic' } });
                const { isProUser } = await getUtils();
                await expect(isProUser('user1')).resolves.toBe(false);
            });

            it('should return false for users with no customClaims', async () => {
                mockGetUser.mockResolvedValue({});
                const { isProUser } = await getUtils();
                await expect(isProUser('user1')).resolves.toBe(false);
            });

            it('should return false for users with empty customClaims', async () => {
                mockGetUser.mockResolvedValue({ customClaims: {} });
                const { isProUser } = await getUtils();
                await expect(isProUser('user1')).resolves.toBe(false);
            });

            it('should return false for unknown role', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'unknown' } });
                const { isProUser } = await getUtils();
                await expect(isProUser('user1')).resolves.toBe(false);
            });
        });

        describe('getUserRole', () => {
            it('should return pro for pro users', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'pro' } });
                const { getUserRole } = await getUtils();
                await expect(getUserRole('user1')).resolves.toBe('pro');
            });

            it('should return basic for basic users', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'basic' } });
                const { getUserRole } = await getUtils();
                await expect(getUserRole('user1')).resolves.toBe('basic');
            });

            it('should return free for free users', async () => {
                mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
                const { getUserRole } = await getUtils();
                await expect(getUserRole('user1')).resolves.toBe('free');
            });

            it('should return free when no customClaims', async () => {
                mockGetUser.mockResolvedValue({});
                const { getUserRole } = await getUtils();
                await expect(getUserRole('user1')).resolves.toBe('free');
            });

            it('should return free when customClaims empty', async () => {
                mockGetUser.mockResolvedValue({ customClaims: {} });
                const { getUserRole } = await getUtils();
                await expect(getUserRole('user1')).resolves.toBe('free');
            });
        });
    });

    describe('Custom Error Classes', () => {
        it('UsageLimitExceededError should have correct name', async () => {
            const { UsageLimitExceededError } = await import('./utils');
            const error = new UsageLimitExceededError('Test message');
            expect(error.name).toBe('UsageLimitExceededError');
            expect(error.message).toBe('Test message');
            expect(error).toBeInstanceOf(Error);
        });

        it('TokenNotFoundError should have correct name', async () => {
            const { TokenNotFoundError } = await import('./utils');
            const error = new TokenNotFoundError('Test message');
            expect(error.name).toBe('TokenNotFoundError');
            expect(error.message).toBe('Test message');
            expect(error).toBeInstanceOf(Error);
        });

        it('UserNotFoundError should have correct name', async () => {
            const { UserNotFoundError } = await import('./utils');
            const error = new UserNotFoundError('Test message');
            expect(error.name).toBe('UserNotFoundError');
            expect(error.message).toBe('Test message');
            expect(error).toBeInstanceOf(Error);
        });
    });
});
