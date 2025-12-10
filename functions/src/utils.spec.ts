import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    generateIDFromParts,
    generateIDFromPartsOld,
    isCorsAllowed,
    determineRedirectURI,
    StreamEncoder,
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

    describe('StreamEncoder', () => {
        describe('compressStream', () => {
            it('should not compress small streams', () => {
                const smallStream = {
                    type: 'test',
                    data: [1, 2, 3, 4, 5],
                };
                const result = StreamEncoder.compressStream(smallStream);
                expect(result.compressionMethod).toBe('None');
                expect(result.encoding).toBe('None');
                expect(result.type).toBe('test');
            });

            it('should preserve data content for small streams', () => {
                const smallStream = {
                    type: 'altitude',
                    data: [100, 150, 200, 180, 160],
                };
                const result = StreamEncoder.compressStream(smallStream);
                expect(JSON.parse(result.data as string)).toEqual([100, 150, 200, 180, 160]);
            });

            it('should compress large streams with pako', () => {
                // Create a large array that exceeds 1MB when JSON stringified
                const largeData = new Array(200000).fill(0).map((_, i) => ({
                    value: i,
                    timestamp: Date.now() + i,
                }));
                const largeStream = {
                    type: 'heartRate',
                    data: largeData,
                };

                const result = StreamEncoder.compressStream(largeStream);
                expect(result.compressionMethod).toBe('Pako');
                expect(result.encoding).toBe('UInt8Array');
            });
        });
    });
});
