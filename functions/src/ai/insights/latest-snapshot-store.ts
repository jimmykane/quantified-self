import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import type { AiInsightsResponse } from '../../../../shared/ai-insights.types';
import { validateAiInsightsLatestSnapshot } from '../../../../shared/ai-insights-latest-snapshot.validation';
import { validateAiInsightsResponse } from '../../../../shared/ai-insights-response.contract';
import { serializeErrorForLogging } from './error-logging';

const AI_INSIGHTS_LATEST_DOC_ID = 'latest';
const AI_INSIGHTS_LATEST_SNAPSHOT_VERSION = 1;
const AI_INSIGHTS_LATEST_SNAPSHOT_MAX_BYTES = 850 * 1024;

export interface AiInsightsLatestSnapshotStoreDependencies {
  db: () => FirebaseFirestore.Firestore;
  now: () => Date;
  logger: Pick<typeof logger, 'warn'>;
}

export interface AiInsightsLatestSnapshotStoreApi {
  persistLatestAiInsightsSnapshot: (
    userID: string,
    prompt: string,
    response: AiInsightsResponse,
  ) => Promise<void>;
}

const defaultAiInsightsLatestSnapshotStoreDependencies: AiInsightsLatestSnapshotStoreDependencies = {
  db: () => admin.firestore(),
  now: () => new Date(),
  logger,
};

function measureUtf8Bytes(serializedValue: string): number {
  return new TextEncoder().encode(serializedValue).length;
}

function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(entry => stripUndefinedDeep(entry))
      .filter(entry => entry !== undefined);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .reduce<Record<string, unknown>>((accumulator, [key, nestedValue]) => {
        const cleanedValue = stripUndefinedDeep(nestedValue);
        if (cleanedValue !== undefined) {
          accumulator[key] = cleanedValue;
        }
        return accumulator;
      }, {});
  }

  return value;
}

export function createAiInsightsLatestSnapshotStore(
  dependencies: Partial<AiInsightsLatestSnapshotStoreDependencies> = {},
): AiInsightsLatestSnapshotStoreApi {
  const resolvedDependencies: AiInsightsLatestSnapshotStoreDependencies = {
    ...defaultAiInsightsLatestSnapshotStoreDependencies,
    ...dependencies,
  };

  return {
    persistLatestAiInsightsSnapshot: async (
      userID: string,
      prompt: string,
      response: AiInsightsResponse,
    ): Promise<void> => {
      const responseValidation = validateAiInsightsResponse(response);
      if (responseValidation.ok === false) {
        resolvedDependencies.logger.warn('[aiInsights] Skipping invalid latest snapshot persistence.', {
          userID,
          reason: `response_${responseValidation.reason}`,
          promptLength: `${prompt || ''}`.trim().length,
          ...responseValidation.details,
        });
        return;
      }

      const snapshot = {
        version: AI_INSIGHTS_LATEST_SNAPSHOT_VERSION,
        savedAt: resolvedDependencies.now().toISOString(),
        prompt,
        response: responseValidation.data,
      };

      const snapshotValidation = validateAiInsightsLatestSnapshot(snapshot, AI_INSIGHTS_LATEST_SNAPSHOT_VERSION);
      if (snapshotValidation.valid === false) {
        resolvedDependencies.logger.warn('[aiInsights] Skipping invalid latest snapshot persistence.', {
          userID,
          reason: snapshotValidation.failure.reason,
          promptLength: `${prompt || ''}`.trim().length,
          ...snapshotValidation.failure.details,
        });
        return;
      }

      const firestoreSnapshot = stripUndefinedDeep(snapshot) as Record<string, unknown>;
      const firestoreSnapshotValidation = validateAiInsightsLatestSnapshot(
        firestoreSnapshot,
        AI_INSIGHTS_LATEST_SNAPSHOT_VERSION,
      );
      if (firestoreSnapshotValidation.valid === false) {
        resolvedDependencies.logger.warn('[aiInsights] Skipping invalid latest snapshot persistence after write-sanitization.', {
          userID,
          reason: firestoreSnapshotValidation.failure.reason,
          promptLength: `${prompt || ''}`.trim().length,
          ...firestoreSnapshotValidation.failure.details,
        });
        return;
      }

      const snapshotBytes = measureUtf8Bytes(JSON.stringify(firestoreSnapshot));
      if (snapshotBytes > AI_INSIGHTS_LATEST_SNAPSHOT_MAX_BYTES) {
        resolvedDependencies.logger.warn('[aiInsights] Skipping latest snapshot persistence because it exceeds the size guard.', {
          userID,
          bytes: snapshotBytes,
          promptLength: `${prompt || ''}`.trim().length,
        });
        return;
      }

      try {
        await resolvedDependencies.db()
          .collection('users')
          .doc(userID)
          .collection('aiInsightsRequests')
          .doc(AI_INSIGHTS_LATEST_DOC_ID)
          .set(firestoreSnapshot);
      } catch (error) {
        resolvedDependencies.logger.warn('[aiInsights] Failed to persist latest snapshot.', {
          userID,
          promptLength: `${prompt || ''}`.trim().length,
          ...serializeErrorForLogging(error),
        });
      }
    },
  };
}
