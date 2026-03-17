import { describe, it, expect } from 'vitest';
import { normalizeDownloadedFitPayload } from './fit-payload';

function createSyntheticFitPayload(dataBytes: Buffer): Buffer {
    const headerSize = 14;
    const result = Buffer.alloc(headerSize + dataBytes.length + 2); // +2 CRC
    result.writeUInt8(headerSize, 0);
    result.writeUInt8(0x20, 1); // protocol version
    result.writeUInt16LE(0, 2); // profile version
    result.writeUInt32LE(dataBytes.length, 4); // data size
    result.write('.FIT', 8, 'ascii');
    dataBytes.copy(result, headerSize);
    // Keep CRC bytes as zero for this synthetic fixture
    return result;
}

describe('normalizeDownloadedFitPayload', () => {
    it('returns raw FIT payload as-is when header starts at byte 0', () => {
        const fitPayload = createSyntheticFitPayload(Buffer.from([0x10, 0x20, 0x30]));
        const normalized = normalizeDownloadedFitPayload(fitPayload);

        expect(normalized.normalizedFromMultipart).toBe(false);
        expect(normalized.fitOffset).toBe(0);
        expect(normalized.data.equals(fitPayload)).toBe(true);
    });

    it('unwraps multipart/form-data wrapper and returns embedded FIT payload', () => {
        const fitPayload = createSyntheticFitPayload(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]));
        const boundary = '------WebKitFormBoundaryTestBoundary';
        const multipartPayload = Buffer.concat([
            Buffer.from(
                `${boundary}\r\n` +
                'Content-Disposition: form-data; name="file"; filename="sample.fit"\r\n' +
                'Content-Type: application/octet-stream\r\n\r\n',
                'latin1'
            ),
            fitPayload,
            Buffer.from(`\r\n${boundary}--\r\n`, 'latin1'),
        ]);

        const normalized = normalizeDownloadedFitPayload(multipartPayload);

        expect(normalized.normalizedFromMultipart).toBe(true);
        expect(normalized.fitOffset).toBeGreaterThan(0);
        expect(normalized.data.equals(fitPayload)).toBe(true);
    });

    it('unwraps multipart wrapper when headers are mixed-case and content-type has parameters', () => {
        const fitPayload = createSyntheticFitPayload(Buffer.from([0x01, 0x02, 0x03, 0x04]));
        const boundary = '------WebKitFormBoundaryCaseInsensitive';
        const multipartPayload = Buffer.concat([
            Buffer.from(
                `${boundary}\r\n` +
                'cOnTeNt-dIsPoSiTiOn: FORM-DATA; name="file"; FILENAME="sample.fit"\r\n' +
                'CONTENT-TYPE: application/octet-stream; charset=binary\r\n\r\n',
                'latin1'
            ),
            fitPayload,
            Buffer.from(`\r\n${boundary}--\r\n`, 'latin1'),
        ]);

        const normalized = normalizeDownloadedFitPayload(multipartPayload);

        expect(normalized.normalizedFromMultipart).toBe(true);
        expect(normalized.fitOffset).toBeGreaterThan(0);
        expect(normalized.data.equals(fitPayload)).toBe(true);
    });

    it('passes unknown payload through unchanged', () => {
        const payload = Buffer.from('not-a-fit-payload', 'utf8');
        const normalized = normalizeDownloadedFitPayload(payload);

        expect(normalized.normalizedFromMultipart).toBe(false);
        expect(normalized.fitOffset).toBe(0);
        expect(normalized.data.equals(payload)).toBe(true);
    });
});
