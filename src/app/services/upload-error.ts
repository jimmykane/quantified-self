export class UploadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

const EXPECTED_UPLOAD_ERROR_STATUSES = new Set([400, 401, 409, 413, 415, 422, 429]);

function getPayloadCode(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.code === 'string') {
    return record.code.trim();
  }

  if (record.error && typeof record.error === 'object') {
    const nestedCode = (record.error as Record<string, unknown>).code;
    return typeof nestedCode === 'string' ? nestedCode.trim() : '';
  }

  return '';
}

function getFallbackCode(status: number): string {
  switch (status) {
    case 400:
      return 'invalid_upload';
    case 401:
      return 'unauthenticated';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_format';
    case 422:
      return 'invalid_payload';
    case 429:
      return 'quota_exceeded';
    default:
      return status >= 500 ? 'server_error' : `http_${status}`;
  }
}

export function createHttpUploadError(message: string, status: number, payload: unknown): UploadError {
  return new UploadError(message, status, getPayloadCode(payload) || getFallbackCode(status));
}

export function shouldReportUploadError(error: unknown): boolean {
  return !(error instanceof UploadError && EXPECTED_UPLOAD_ERROR_STATUSES.has(error.status));
}
