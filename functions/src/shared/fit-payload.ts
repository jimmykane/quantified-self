export interface NormalizedFitPayload {
    data: Buffer;
    normalizedFromMultipart: boolean;
    fitOffset: number;
}

export type FitPayloadInspectionReason =
    | 'valid'
    | 'too_short'
    | 'invalid_header_size'
    | 'missing_fit_signature'
    | 'truncated_header'
    | 'truncated_payload';

export interface FitPayloadInspection {
    byteLength: number;
    isCompleteFit: boolean;
    reason: FitPayloadInspectionReason;
    headerSize: number | null;
    declaredDataSize: number | null;
    minimumTotalLength: number | null;
    normalizedFitLength: number | null;
}

function toBuffer(payload: Buffer | ArrayBuffer | Uint8Array): Buffer {
    if (Buffer.isBuffer(payload)) {
        return payload;
    }
    if (payload instanceof ArrayBuffer) {
        return Buffer.from(payload);
    }
    return Buffer.from(payload);
}

function inspectFitPayloadAt(buffer: Buffer, start: number): FitPayloadInspection {
    const byteLength = start >= 0 && start <= buffer.length ? buffer.length - start : 0;
    const invalid = (
        reason: Exclude<FitPayloadInspectionReason, 'valid'>,
        headerSize: number | null = null,
        declaredDataSize: number | null = null,
        minimumTotalLength: number | null = null,
    ): FitPayloadInspection => ({
        byteLength,
        isCompleteFit: false,
        reason,
        headerSize,
        declaredDataSize,
        minimumTotalLength,
        normalizedFitLength: null,
    });

    // FIT header fields through the ".FIT" signature occupy the first 12 bytes.
    if (start < 0 || byteLength < 12) {
        return invalid('too_short');
    }

    const headerSize = buffer.readUInt8(start);
    if (headerSize !== 12 && headerSize !== 14) {
        return invalid('invalid_header_size', headerSize);
    }

    const sig = buffer.subarray(start + 8, start + 12).toString('ascii');
    if (sig !== '.FIT') {
        return invalid('missing_fit_signature', headerSize);
    }
    if (start + headerSize > buffer.length) {
        return invalid('truncated_header', headerSize);
    }

    const dataSize = buffer.readUInt32LE(start + 4);
    const minimumTotalLength = headerSize + dataSize;
    if (start + minimumTotalLength > buffer.length) {
        return invalid('truncated_payload', headerSize, dataSize, minimumTotalLength);
    }
    // The parser's best-effort mode accepts a missing file CRC. Retain it when present,
    // but do not classify a complete declared data section as truncated without it.
    const normalizedFitLength = byteLength >= minimumTotalLength + 2
        ? minimumTotalLength + 2
        : minimumTotalLength;

    return {
        byteLength,
        isCompleteFit: true,
        reason: 'valid',
        headerSize,
        declaredDataSize: dataSize,
        minimumTotalLength,
        normalizedFitLength,
    };
}

export function inspectFitPayload(payload: Buffer | ArrayBuffer | Uint8Array): FitPayloadInspection {
    const buffer = toBuffer(payload);
    return inspectFitPayloadAt(buffer, 0);
}

function hasMultipartPrefix(prefix: Buffer): boolean {
    const normalizedPrefix = prefix.toString('latin1').toLowerCase();
    const hasBoundaryPrefix = normalizedPrefix.startsWith('--');
    const hasContentDisposition = /content-disposition\s*:\s*form-data\b/.test(normalizedPrefix);
    const hasFilename = /filename\s*=/.test(normalizedPrefix);
    const contentTypeMatch = normalizedPrefix.match(/content-type\s*:\s*([^\r\n]+)/);
    const hasOctetStreamContentType = contentTypeMatch !== null &&
        contentTypeMatch[1].trim().startsWith('application/octet-stream');

    return hasBoundaryPrefix &&
        hasContentDisposition &&
        hasFilename &&
        hasOctetStreamContentType;
}

export function normalizeDownloadedFitPayload(payload: Buffer | ArrayBuffer | Uint8Array): NormalizedFitPayload {
    const buffer = toBuffer(payload);

    // Fast-path: already a valid FIT payload from byte zero.
    const rootInspection = inspectFitPayloadAt(buffer, 0);
    if (rootInspection.isCompleteFit && rootInspection.normalizedFitLength !== null) {
        return {
            data: buffer.subarray(0, rootInspection.normalizedFitLength),
            normalizedFromMultipart: false,
            fitOffset: 0,
        };
    }

    // Multipart payloads usually include ".FIT" in part body headers; FIT header starts 8 bytes before that.
    for (let i = 8; i < buffer.length - 4; i++) {
        if (
            buffer[i] === 0x2e && // .
            buffer[i + 1] === 0x46 && // F
            buffer[i + 2] === 0x49 && // I
            buffer[i + 3] === 0x54 // T
        ) {
            const start = i - 8;
            const inspection = inspectFitPayloadAt(buffer, start);
            if (!inspection.isCompleteFit || inspection.normalizedFitLength === null) {
                continue;
            }

            const prefix = buffer.subarray(0, start);
            if (!hasMultipartPrefix(prefix)) {
                continue;
            }

            return {
                data: buffer.subarray(start, start + inspection.normalizedFitLength),
                normalizedFromMultipart: true,
                fitOffset: start,
            };
        }
    }

    // Unknown format; pass-through so caller can surface parser error.
    return {
        data: buffer,
        normalizedFromMultipart: false,
        fitOffset: 0,
    };
}
