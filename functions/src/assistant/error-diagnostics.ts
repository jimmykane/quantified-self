import { ZodError } from 'zod';

const SAFE_ERROR_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ABORT_ERR',
  'cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded', 'not-found',
  'already-exists', 'permission-denied', 'resource-exhausted', 'failed-precondition',
  'aborted', 'out-of-range', 'unimplemented', 'internal', 'unavailable', 'data-loss',
  'unauthenticated', 'auth/network-request-failed', 'app/network-error',
]);
const SAFE_SCHEMA_CODES = new Set([
  'invalid_type', 'too_big', 'too_small', 'invalid_format', 'not_multiple_of',
  'unrecognized_keys', 'invalid_union', 'invalid_key', 'invalid_element', 'invalid_value', 'custom',
]);
// Only fixed schema labels may appear. Never log arbitrary object keys or array indexes.
const SAFE_SCHEMA_FIELDS = new Set([
  'changes', 'change', 'kind', 'structure', 'version', 'sport', 'nodes', 'steps',
  'purpose', 'ending', 'targets', 'seconds', 'meters', 'value', 'min', 'max',
  'title', 'note', 'details', 'category', 'localDate', 'startDate', 'endDate', 'timeZone',
  'expectedRevision', 'expectedScheduleRevision', 'scheduleRevision', 'permissionMode',
  'proposalRef', 'expiresAtMs', 'requiresConfirmation', 'summary', 'providerPreviews',
  'arguments', 'mutationId', 'activityRef', 'noteRef', 'tags', 'expectedTags', 'showOnCharts', 'color',
]);
const MAX_SCHEMA_ISSUES = 5;
const MAX_SCHEMA_PATH_DEPTH = 8;

export interface AssistantErrorDiagnostic {
  causeErrorType: 'ZodError' | 'TypeError' | 'RangeError' | 'SyntaxError' | 'Error' | 'unknown';
  causeErrorCode: string;
  causeSchemaIssues?: { code: string; path: string }[];
}

/** No messages, stacks, nested causes, authored values or arbitrary names/codes enter logs. */
export function getAssistantErrorDiagnostic(error: unknown): AssistantErrorDiagnostic {
  try {
    const causeErrorType = error instanceof ZodError ? 'ZodError'
      : error instanceof TypeError ? 'TypeError'
      : error instanceof RangeError ? 'RangeError'
      : error instanceof SyntaxError ? 'SyntaxError'
      : error instanceof Error ? 'Error' : 'unknown';
    // Avoid invoking a code getter while handling another failure.
    const code = error && typeof error === 'object'
      ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
    const causeErrorCode = typeof code === 'string' && SAFE_ERROR_CODES.has(code) ? code
      : typeof code === 'number' && Number.isInteger(code)
        && ((code >= 1 && code <= 16) || [-32700, -32600, -32601, -32602, -32603, -32000].includes(code))
        ? String(code) : 'unknown';
    return {
      causeErrorType,
      causeErrorCode,
      ...(error instanceof ZodError ? {
        causeSchemaIssues: error.issues.slice(0, MAX_SCHEMA_ISSUES).map(issue => ({
          code: SAFE_SCHEMA_CODES.has(issue.code) ? issue.code : 'unknown',
          path: ['$', ...issue.path.slice(0, MAX_SCHEMA_PATH_DEPTH).map(part => (
            typeof part === 'string' && SAFE_SCHEMA_FIELDS.has(part) ? part
              : typeof part === 'number' ? '*' : '<field>'
          )), ...(issue.path.length > MAX_SCHEMA_PATH_DEPTH ? ['…'] : [])].join('.'),
        })),
      } : {}),
    };
  } catch {
    // Diagnostics must never replace the original failure, even for malformed thrown objects.
    return { causeErrorType: 'unknown', causeErrorCode: 'unknown' };
  }
}
