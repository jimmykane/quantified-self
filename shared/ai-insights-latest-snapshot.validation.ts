import type { AiInsightsLatestSnapshot } from './ai-insights.types';
import { validateAiInsightsResponse } from './ai-insights-response.contract';

type UnknownRecord = Record<string, unknown>;

export type AiInsightsLatestSnapshotValidationFailure = {
  reason: string;
  details?: UnknownRecord;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValueType(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

export function getAiInsightsLatestSnapshotValidationFailure(
  value: unknown,
  expectedVersion: number,
): AiInsightsLatestSnapshotValidationFailure | null {
  if (!isRecord(value)) {
    return {
      reason: 'snapshot_not_object',
      details: {
        actualType: describeValueType(value),
      },
    };
  }

  if (value.version !== expectedVersion) {
    return {
      reason: 'version_mismatch',
      details: {
        actualVersion: value.version ?? null,
        expectedVersion,
        topLevelKeys: Object.keys(value),
      },
    };
  }

  if (typeof value.savedAt !== 'string') {
    return {
      reason: 'savedAt_invalid',
      details: {
        actualType: describeValueType(value.savedAt),
        topLevelKeys: Object.keys(value),
      },
    };
  }

  if (typeof value.prompt !== 'string') {
    return {
      reason: 'prompt_invalid',
      details: {
        actualType: describeValueType(value.prompt),
        topLevelKeys: Object.keys(value),
      },
    };
  }

  const responseValidation = validateAiInsightsResponse(value.response);
  if (responseValidation.ok === false) {
    return {
      reason: `response_${responseValidation.reason}`,
      details: {
        topLevelKeys: Object.keys(value),
        ...responseValidation.details,
      },
    };
  }

  return null;
}

export function validateAiInsightsLatestSnapshot(
  value: unknown,
  expectedVersion: number,
): (
  { valid: true; snapshot: AiInsightsLatestSnapshot }
  | { valid: false; failure: AiInsightsLatestSnapshotValidationFailure }
) {
  const failure = getAiInsightsLatestSnapshotValidationFailure(value, expectedVersion);
  if (failure || !isRecord(value)) {
    return {
      valid: false,
      failure: failure ?? { reason: 'snapshot_not_object' },
    };
  }

  const parsedResponse = validateAiInsightsResponse(value.response);
  if (parsedResponse.ok === false) {
    return {
      valid: false,
      failure: {
        reason: `response_${parsedResponse.reason}`,
        details: {
          topLevelKeys: Object.keys(value),
          ...parsedResponse.details,
        },
      },
    };
  }

  return {
    valid: true,
    snapshot: {
      version: value.version as number,
      savedAt: value.savedAt as string,
      prompt: value.prompt as string,
      response: parsedResponse.data,
    },
  };
}
