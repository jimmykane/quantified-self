import { EnvironmentInjector, Injectable, inject, runInInjectionContext } from '@angular/core';
import {
  Firestore,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
} from '@angular/fire/firestore';
import type { AiInsightsLatestSnapshot, AiInsightsResponse } from '@shared/ai-insights.types';
import { validateAiInsightsLatestSnapshot } from '@shared/ai-insights-latest-snapshot.validation';
import { validateAiInsightsResponse } from '@shared/ai-insights-response.contract';
import { LoggerService } from './logger.service';

const AI_INSIGHTS_LATEST_DOC_ID = 'latest';
const AI_INSIGHTS_LATEST_SNAPSHOT_VERSION = 1;
const AI_INSIGHTS_LATEST_SNAPSHOT_MAX_BYTES = 850 * 1024;

export type AiInsightsLatestSnapshotSaveResult =
  | 'saved'
  | 'skipped_too_large'
  | 'failed';

@Injectable({
  providedIn: 'root',
})
export class AiInsightsLatestSnapshotService {
  private readonly firestore = inject(Firestore);
  private readonly injector = inject(EnvironmentInjector);
  private readonly logger = inject(LoggerService);

  async loadLatest(userID: string): Promise<AiInsightsLatestSnapshot | null> {
    try {
      const latestSnapshot = await runInInjectionContext(this.injector, () =>
        getDoc(doc(this.firestore, 'users', userID, 'aiInsightsRequests', AI_INSIGHTS_LATEST_DOC_ID)));
      if (!latestSnapshot.exists()) {
        return null;
      }

      const validationResult = validateAiInsightsLatestSnapshot(
        latestSnapshot.data(),
        AI_INSIGHTS_LATEST_SNAPSHOT_VERSION,
      );
      if (validationResult.valid === false) {
        this.logger.warn('[AiInsightsLatestSnapshotService] Clearing invalid latest AI insight snapshot.', {
          userID,
          reason: validationResult.failure.reason,
          ...validationResult.failure.details,
        });
        await this.deleteLatest(userID);
        return null;
      }

      return validationResult.snapshot;
    } catch (error) {
      this.logger.error('[AiInsightsLatestSnapshotService] Failed to load latest AI insight snapshot.', { userID, error });
      return null;
    }
  }

  async saveLatest(
    userID: string,
    prompt: string,
    response: AiInsightsResponse,
  ): Promise<AiInsightsLatestSnapshotSaveResult> {
    const responseValidation = validateAiInsightsResponse(response);
    if (responseValidation.ok === false) {
      this.logger.warn('[AiInsightsLatestSnapshotService] Skipping invalid latest AI insight snapshot before save.', {
        userID,
        reason: `response_${responseValidation.reason}`,
        ...responseValidation.details,
      });
      return 'failed';
    }

    const snapshot: AiInsightsLatestSnapshot = {
      version: AI_INSIGHTS_LATEST_SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      prompt,
      response: responseValidation.data,
    };

    const snapshotValidation = validateAiInsightsLatestSnapshot(snapshot, AI_INSIGHTS_LATEST_SNAPSHOT_VERSION);
    if (snapshotValidation.valid === false) {
      this.logger.warn('[AiInsightsLatestSnapshotService] Skipping invalid latest AI insight snapshot before save.', {
        userID,
        reason: snapshotValidation.failure.reason,
        ...snapshotValidation.failure.details,
      });
      return 'failed';
    }

    const serializedSnapshot = JSON.stringify(snapshot);
    const snapshotBytes = measureUtf8Bytes(serializedSnapshot);
    if (snapshotBytes > AI_INSIGHTS_LATEST_SNAPSHOT_MAX_BYTES) {
      this.logger.warn('[AiInsightsLatestSnapshotService] Skipping latest AI insight snapshot because it exceeds the size guard.', {
        userID,
        bytes: snapshotBytes,
      });
      return 'skipped_too_large';
    }

    try {
      await runInInjectionContext(this.injector, () =>
        setDoc(doc(this.firestore, 'users', userID, 'aiInsightsRequests', AI_INSIGHTS_LATEST_DOC_ID), snapshot));
      return 'saved';
    } catch (error) {
      this.logger.error('[AiInsightsLatestSnapshotService] Failed to save latest AI insight snapshot.', { userID, error });
      return 'failed';
    }
  }

  private async deleteLatest(userID: string): Promise<void> {
    try {
      await runInInjectionContext(this.injector, () =>
        deleteDoc(doc(this.firestore, 'users', userID, 'aiInsightsRequests', AI_INSIGHTS_LATEST_DOC_ID)));
    } catch (error) {
      this.logger.error('[AiInsightsLatestSnapshotService] Failed to delete invalid latest AI insight snapshot.', { userID, error });
    }
  }
}

function measureUtf8Bytes(serializedValue: string): number {
  return new TextEncoder().encode(serializedValue).length;
}
