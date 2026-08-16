export class ResponseBodyTooLargeError extends Error {
    readonly name = 'ResponseBodyTooLargeError';

    constructor(
        public readonly maxResponseBytes: number,
        public readonly receivedBytes: number,
    ) {
        super('Response body exceeded its configured byte limit.');
    }
}

export interface BoundedBinaryResponse {
    body: Buffer;
    statusCode: number;
    contentType: string | null;
    contentLength: number | null;
}

function normalizeMaxResponseBytes(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError('maxResponseBytes must be a positive safe integer.');
    }
    return value;
}

async function cancelResponseBody(response: Response): Promise<void> {
    try {
        await response.body?.cancel();
    } catch {
        // The byte limit has already been enforced; cancellation is best-effort.
    }
}

async function readResponseBodyWithinLimit(
    response: Response,
    maxResponseBytes: number,
): Promise<Buffer> {
    const contentLengthHeader = response.headers.get('content-length')?.trim() || '';
    const contentLength = /^\d+$/.test(contentLengthHeader)
        ? Number(contentLengthHeader)
        : null;
    if (contentLength !== null && contentLength > maxResponseBytes) {
        await cancelResponseBody(response);
        throw new ResponseBodyTooLargeError(maxResponseBytes, contentLength);
    }

    if (!response.body) return Buffer.alloc(0);

    const reader = response.body.getReader();
    let bodyBuffer = Buffer.allocUnsafe(Math.min(
        maxResponseBytes,
        Math.max(8 * 1024, contentLength || 0),
    ));
    let receivedBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const nextReceivedBytes = receivedBytes + value.byteLength;
            if (nextReceivedBytes > maxResponseBytes) {
                try {
                    await reader.cancel();
                } catch {
                    // The byte limit has already been enforced; cancellation is best-effort.
                }
                throw new ResponseBodyTooLargeError(maxResponseBytes, nextReceivedBytes);
            }
            if (nextReceivedBytes > bodyBuffer.length) {
                const expandedBuffer = Buffer.allocUnsafe(Math.min(
                    maxResponseBytes,
                    Math.max(nextReceivedBytes, bodyBuffer.length * 2),
                ));
                bodyBuffer.copy(expandedBuffer, 0, 0, receivedBytes);
                bodyBuffer = expandedBuffer;
            }
            bodyBuffer.set(value, receivedBytes);
            receivedBytes = nextReceivedBytes;
        }
    } finally {
        reader.releaseLock();
    }
    return bodyBuffer.subarray(0, receivedBytes);
}

export async function get(urlOrOptions: string | any, options: any = {}) {
    return request(urlOrOptions, { ...options, method: 'GET' });
}

export async function getBinaryResponse(
    urlOrOptions: string | any,
    options: any = {},
): Promise<BoundedBinaryResponse> {
    return request(urlOrOptions, {
        ...options,
        method: 'GET',
        encoding: null,
        includeBinaryResponseMetadata: true,
    });
}

export async function post(urlOrOptions: string | any, options: any = {}) {
    return request(urlOrOptions, { ...options, method: 'POST' });
}

export async function put(urlOrOptions: string | any, options: any = {}) {
    return request(urlOrOptions, { ...options, method: 'PUT' });
}

export async function del(urlOrOptions: string | any, options: any = {}) {
    return request(urlOrOptions, { ...options, method: 'DELETE' });
}

async function request(urlOrOptions: string | any, options: any = {}) {
    let url: string;
    let opts: any;

    if (typeof urlOrOptions === 'string') {
        url = urlOrOptions;
        opts = options;
    } else {
        url = urlOrOptions.url || urlOrOptions.uri;
        if (!url) throw new Error('Missing URL in options');
        opts = { ...urlOrOptions, ...options };
    }

    const fetchOptions: any = {
        method: opts.method || 'GET',
        headers: opts.headers || {},
    };

    if (opts.body) {
        if (typeof opts.body === 'object' && opts.json !== false) {
            fetchOptions.body = JSON.stringify(opts.body);
            if (!fetchOptions.headers['Content-Type']) {
                fetchOptions.headers['Content-Type'] = 'application/json';
            }
        } else {
            fetchOptions.body = opts.body;
        }
    } else if (opts.form) {
        const params = new URLSearchParams();
        for (const key in opts.form) {
            params.append(key, opts.form[key]);
        }
        fetchOptions.body = params;
    }

    if (opts.auth && opts.auth.bearer) {
        fetchOptions.headers['Authorization'] = `Bearer ${opts.auth.bearer}`;
    }

    const timeoutMs = Number(opts.timeout);
    const maxResponseBytes = normalizeMaxResponseBytes(opts.maxResponseBytes);
    if (opts.includeBinaryResponseMetadata === true && maxResponseBytes === null) {
        throw new TypeError('Binary responses require an explicit maxResponseBytes limit.');
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            const timeoutController = new AbortController();
            timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
            fetchOptions.signal = opts.signal
                ? AbortSignal.any([opts.signal, timeoutController.signal])
                : timeoutController.signal;
        } else if (opts.signal) {
            fetchOptions.signal = opts.signal;
        }

        const response = await fetch(url, fetchOptions);
        const boundedResponseBody = maxResponseBytes === null
            ? null
            : await readResponseBodyWithinLimit(response, maxResponseBytes);

        if (!response.ok) {
            const err: any = new Error(`StatusCodeError: ${response.status} - ${response.statusText}`);
            err.statusCode = response.status;
            try {
                err.error = boundedResponseBody === null
                    ? await response.text()
                    : boundedResponseBody.toString('utf8');
                try {
                    err.error = JSON.parse(err.error);
                } catch { // ignore
                }
            } catch { // ignore
            }
            throw err;
        }

        if (opts.encoding === null) {
            const body = boundedResponseBody === null
                ? Buffer.from(await response.arrayBuffer())
                : boundedResponseBody;
            if (opts.includeBinaryResponseMetadata === true) {
                const contentLengthHeader = response.headers.get('content-length')?.trim() || '';
                return {
                    body,
                    statusCode: response.status,
                    contentType: response.headers.get('content-type'),
                    contentLength: /^\d+$/.test(contentLengthHeader)
                        ? Number(contentLengthHeader)
                        : null,
                } satisfies BoundedBinaryResponse;
            }
            return body;
        }

        // Default to JSON parsing only if json: true is explicitly set (matching request-promise-native)
        if (opts.json === true) {
            return boundedResponseBody === null
                ? response.json()
                : JSON.parse(boundedResponseBody.toString('utf8'));
        }

        return boundedResponseBody === null
            ? response.text()
            : boundedResponseBody.toString('utf8');
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

const requestFn = request as any;
requestFn.get = get;
requestFn.getBinaryResponse = getBinaryResponse;
requestFn.post = post;
requestFn.put = put;
requestFn.delete = del;

export { del as delete };

export default requestFn;
