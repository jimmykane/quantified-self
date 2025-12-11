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


});
