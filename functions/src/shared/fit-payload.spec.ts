import { describe, it, expect } from 'vitest';
import { inspectFitPayload, normalizeDownloadedFitPayload } from './fit-payload';

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

    it.each([
        'application/octet-stream', 'application/vnd.ant.fit',
    ])('unwraps a multipart %s part and returns the embedded FIT payload', (contentType) => {
        const fitPayload = createSyntheticFitPayload(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]));
        const boundary = '------WebKitFormBoundaryTestBoundary';
        const multipartPayload = Buffer.concat([
            Buffer.from(
                `${boundary}\r\n` +
                'Content-Disposition: form-data; name="file"; filename="sample.fit"\r\n' +
                `Content-Type: ${contentType}\r\n\r\n`,
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

    it.each([
        'APPLICATION/OCTET-STREAM', 'Application/Vnd.Ant.Fit',
    ])('unwraps mixed-case multipart headers with %s and parameters', (contentType) => {
        const fitPayload = createSyntheticFitPayload(Buffer.from([0x01, 0x02, 0x03, 0x04]));
        const boundary = '------WebKitFormBoundaryCaseInsensitive';
        const multipartPayload = Buffer.concat([
            Buffer.from(
                `${boundary}\r\n` +
                'cOnTeNt-dIsPoSiTiOn: FORM-DATA; name="file"; FILENAME="sample.fit"\r\n' +
                `CONTENT-TYPE: ${contentType}; charset=binary\r\n\r\n`,
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

    it.each([
        'application/octet-stream', 'application/vnd.ant.fit',
    ])('does not let a multipart %s boundary hide a missing FIT file CRC', (contentType) => {
        const fitPayload = createSyntheticFitPayload(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]));
        const truncatedFit = fitPayload.subarray(0, fitPayload.length - 2);
        const boundary = '------WebKitFormBoundaryTruncatedFit';
        const multipartPayload = Buffer.concat([
            Buffer.from(
                `${boundary}\r\n` +
                'Content-Disposition: form-data; name="file"; filename="sample.fit"\r\n' +
                `Content-Type: ${contentType}\r\n\r\n`,
                'latin1'
            ),
            truncatedFit,
            Buffer.from(`\r\n${boundary}--\r\n`, 'latin1'),
        ]);

        const normalized = normalizeDownloadedFitPayload(multipartPayload);

        expect(normalized.normalizedFromMultipart).toBe(false);
        expect(normalized.data.equals(multipartPayload)).toBe(true);
    });

    it.each([
        'text/plain',
        'application/json',
        'application/octet-stream-extra',
        'application/vnd.ant.fit-extra',
    ])('does not unwrap an unsupported multipart media type %s', (contentType) => {
        const fitPayload = createSyntheticFitPayload(Buffer.from([0x01, 0x02]));
        const boundary = '------UnsupportedTypeBoundary';
        const multipartPayload = Buffer.concat([
            Buffer.from(`${boundary}\r\n`
                + 'Content-Disposition: form-data; name="file"; filename="sample.fit"\r\n'
                + `Content-Type: ${contentType}\r\n\r\n`, 'latin1'),
            fitPayload,
            Buffer.from(`\r\n${boundary}--\r\n`, 'latin1'),
        ]);

        const normalized = normalizeDownloadedFitPayload(multipartPayload);

        expect(normalized.normalizedFromMultipart).toBe(false);
        expect(normalized.data.equals(multipartPayload)).toBe(true);
    });

    it.each([
        'application/octet-stream', 'application/vnd.ant.fit',
    ])('does not unwrap a multipart %s part without its matching boundary', (contentType) => {
        const fitPayload = createSyntheticFitPayload(Buffer.from([0x01, 0x02]));
        const multipartPayload = Buffer.concat([
            Buffer.from('------ExpectedBoundary\r\n'
                + 'Content-Disposition: form-data; name="file"; filename="sample.fit"\r\n'
                + `Content-Type: ${contentType}\r\n\r\n`, 'latin1'),
            fitPayload,
            Buffer.from('\r\n------DifferentBoundary--\r\n', 'latin1'),
        ]);

        const normalized = normalizeDownloadedFitPayload(multipartPayload);

        expect(normalized.normalizedFromMultipart).toBe(false);
        expect(normalized.data.equals(multipartPayload)).toBe(true);
    });

    it('passes unknown payload through unchanged', () => {
        const payload = Buffer.from('not-a-fit-payload', 'utf8');
        const normalized = normalizeDownloadedFitPayload(payload);

        expect(normalized.normalizedFromMultipart).toBe(false);
        expect(normalized.fitOffset).toBe(0);
        expect(normalized.data.equals(payload)).toBe(true);
    });

    it('reports a complete FIT envelope without parsing activity records', () => {
        const fitPayload = createSyntheticFitPayload(Buffer.from([0x10, 0x20, 0x30]));

        expect(inspectFitPayload(fitPayload)).toEqual({
            byteLength: fitPayload.length,
            isCompleteFit: true,
            reason: 'valid',
            headerSize: 14,
            declaredDataSize: 3,
            expectedTotalLength: fitPayload.length,
        });
    });

    it('classifies a provider text body without retaining its contents', () => {
        const payload = Buffer.from('{"error":"temporarily unavailable"}', 'utf8');

        expect(inspectFitPayload(payload)).toMatchObject({
            byteLength: payload.length,
            isCompleteFit: false,
            reason: 'invalid_header_size',
            declaredDataSize: null,
            expectedTotalLength: null,
        });
    });

    it('classifies a truncated FIT envelope with its expected byte length', () => {
        const fitPayload = createSyntheticFitPayload(Buffer.alloc(40));
        const truncated = fitPayload.subarray(0, 20);

        expect(inspectFitPayload(truncated)).toEqual({
            byteLength: truncated.length,
            isCompleteFit: false,
            reason: 'truncated_payload',
            headerSize: 14,
            declaredDataSize: 40,
            expectedTotalLength: fitPayload.length,
        });
    });

    it('classifies a FIT missing its trailing file CRC as truncated', () => {
        const fitPayload = createSyntheticFitPayload(Buffer.from([0x10, 0x20, 0x30]));
        const withoutFileCRC = fitPayload.subarray(0, fitPayload.length - 2);

        expect(inspectFitPayload(withoutFileCRC)).toMatchObject({
            isCompleteFit: false,
            expectedTotalLength: fitPayload.length,
            reason: 'truncated_payload',
        });
    });

    it('rejects header sizes that the FIT parser does not support', () => {
        const fitPayload = createSyntheticFitPayload(Buffer.from([0x10, 0x20, 0x30]));
        fitPayload.writeUInt8(13, 0);

        expect(inspectFitPayload(fitPayload)).toMatchObject({
            isCompleteFit: false,
            headerSize: 13,
            reason: 'invalid_header_size',
        });
    });
});
