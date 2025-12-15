import { StreamEncoder } from './stream.encoder';
import { CompressionMethods, CompressionEncodings } from '@sports-alliance/sports-lib';
import { StreamJSONInterface } from '@sports-alliance/sports-lib';
import { Bytes } from 'firebase/firestore';
import * as Pako from 'pako';

// Mock Bytes if needed, but it should be available from firebase/firestore
// However, in some test environments firebase specific classes might need attention.
// Assuming vitest environment is set up correctly for this project.

describe('StreamEncoder', () => {
    const smallData = { key: 'value', number: 123 };
    const largeData = {
        key: 'value',
        data: 'x'.repeat(1024 * 1024 * 2) // > 1MB to force compression
    };

    const simpleStream: StreamJSONInterface = {
        type: 'TestStream',
        data: smallData,
    };

    const largeStream: StreamJSONInterface = {
        type: 'LargeTestStream',
        data: largeData,
    };

    it('should not compress small streams and keep method as None', () => {
        const result = StreamEncoder.compressStream(simpleStream);
        expect(result.compressionMethod).toBe(CompressionMethods.None);
        expect(result.encoding).toBe(CompressionEncodings.None);
        expect(JSON.parse(result.data)).toEqual(smallData);
    });

    it('should compress large streams using Pako', () => {
        // We need to make sure the data is actually large enough to trigger the > 1048487 check in StreamEncoder
        // The threshold in code is 1048487 bytes.
        // However, StreamEncoder logic is:
        // 1. Check if raw stringified fits. If yes, return None.
        // 2. If no, compress with Pako.

        // Create a really large object
        const bigString = 'A'.repeat(1048487 + 100);
        const bigStream: StreamJSONInterface = {
            type: 'BigStream',
            data: { payload: bigString }
        };

        const result = StreamEncoder.compressStream(bigStream);

        // It should now be compressed
        expect(result.compressionMethod).toBe(CompressionMethods.Pako);
        expect(result.encoding).toBe(CompressionEncodings.UInt8Array);
        expect(result.data).toBeInstanceOf(Bytes);
    });

    it('should decompress a Pako compressed stream correctly', () => {
        const bigString = 'B'.repeat(10000); // Not huge, but we can force it or just simulating a compressed input
        const originalData = { payload: bigString };
        const stringified = JSON.stringify(originalData);

        // Manually compress to simulate what we expect
        const compressedData = Pako.gzip(stringified);
        const bytesData = Bytes.fromUint8Array(compressedData);

        const compressedStreamJSON = {
            type: 'TestDecompress',
            compressionMethod: CompressionMethods.Pako,
            encoding: CompressionEncodings.UInt8Array,
            data: bytesData
        };

        const decompressed = StreamEncoder.decompressStream(compressedStreamJSON as any);
        // Cast to any because the interface might expect specific types we are constructing manually

        expect(decompressed.data).toEqual(originalData);
        expect(decompressed.type).toBe('TestDecompress');
    });

    it('should round-trip compress and decompress a large stream', () => {
        // Ensure it's large enough to trigger compression but small enough not to throw the "still too large" error
        // The error is thrown if compressed size > 1048487. 
        // Pako compression usually reduces size significantly, so a 1.2MB string likely compresses to < 1MB.

        const bigString = 'C'.repeat(1048487 + 500);
        const stream: StreamJSONInterface = {
            type: 'RoundTrip',
            data: { payload: bigString }
        };

        const compressed = StreamEncoder.compressStream(stream);
        expect(compressed.compressionMethod).toBe(CompressionMethods.Pako);

        const decompressed = StreamEncoder.decompressStream(compressed);
        expect(decompressed.data).toEqual(stream.data);
    });
});
