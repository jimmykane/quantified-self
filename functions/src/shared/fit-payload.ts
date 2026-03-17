export interface NormalizedFitPayload {
    data: Buffer;
    normalizedFromMultipart: boolean;
    fitOffset: number;
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

function readFitHeaderAt(buffer: Buffer, start: number): { totalLength: number } | null {
    // FIT header must contain at least header size byte + protocol/profile/data size + ".FIT"
    if (start < 0 || start + 14 > buffer.length) {
        return null;
    }

    const headerSize = buffer.readUInt8(start);
    if (headerSize < 12 || headerSize > 64) {
        return null;
    }
    if (start + headerSize > buffer.length) {
        return null;
    }

    const sig = buffer.subarray(start + 8, start + 12).toString('ascii');
    if (sig !== '.FIT') {
        return null;
    }

    const dataSize = buffer.readUInt32LE(start + 4);
    const totalLength = headerSize + dataSize + 2; // +2 FIT CRC bytes
    if (totalLength <= 0 || start + totalLength > buffer.length) {
        return null;
    }

    return { totalLength };
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
    const rootHeader = readFitHeaderAt(buffer, 0);
    if (rootHeader) {
        return {
            data: buffer.subarray(0, rootHeader.totalLength),
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
            const header = readFitHeaderAt(buffer, start);
            if (!header) {
                continue;
            }

            const prefix = buffer.subarray(0, start);
            if (!hasMultipartPrefix(prefix)) {
                continue;
            }

            return {
                data: buffer.subarray(start, start + header.totalLength),
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
