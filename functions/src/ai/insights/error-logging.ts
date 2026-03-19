export function serializeErrorForLogging(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const errorWithMetadata = error as Error & {
      code?: unknown;
      details?: unknown;
      cause?: unknown;
    };

    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(typeof error.stack === 'string' ? { errorStack: error.stack } : {}),
      ...(errorWithMetadata.code !== undefined ? { errorCode: errorWithMetadata.code } : {}),
      ...(errorWithMetadata.details !== undefined ? { errorDetails: errorWithMetadata.details } : {}),
      ...(errorWithMetadata.cause !== undefined ? { errorCause: `${errorWithMetadata.cause}` } : {}),
    };
  }

  if (typeof error === 'object' && error !== null) {
    const errorRecord = error as Record<string, unknown>;
    return {
      ...(typeof errorRecord.name === 'string' ? { errorName: errorRecord.name } : {}),
      ...(typeof errorRecord.message === 'string' ? { errorMessage: errorRecord.message } : {}),
      ...(typeof errorRecord.stack === 'string' ? { errorStack: errorRecord.stack } : {}),
      ...(errorRecord.code !== undefined ? { errorCode: errorRecord.code } : {}),
      ...(errorRecord.details !== undefined ? { errorDetails: errorRecord.details } : {}),
      ...(errorRecord.cause !== undefined ? { errorCause: `${errorRecord.cause}` } : {}),
      errorType: 'object',
    };
  }

  return {
    errorMessage: `${error}`,
    errorType: typeof error,
  };
}
