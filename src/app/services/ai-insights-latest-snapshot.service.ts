import { EnvironmentInjector, Injectable, inject, runInInjectionContext } from '@angular/core';
import {
  Firestore,
  deleteDoc,
  doc,
  getDoc,
} from '@angular/fire/firestore';
import type { AiInsightsLatestSnapshot } from '@shared/ai-insights.types';
import { validateAiInsightsLatestSnapshot } from '@shared/ai-insights-latest-snapshot.validation';
import { LoggerService } from './logger.service';

const AI_INSIGHTS_LATEST_DOC_ID = 'latest';
const AI_INSIGHTS_LATEST_SNAPSHOT_VERSION = 1;

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

  private async deleteLatest(userID: string): Promise<void> {
    try {
      await runInInjectionContext(this.injector, () =>
        deleteDoc(doc(this.firestore, 'users', userID, 'aiInsightsRequests', AI_INSIGHTS_LATEST_DOC_ID)));
    } catch (error) {
      this.logger.error('[AiInsightsLatestSnapshotService] Failed to delete invalid latest AI insight snapshot.', { userID, error });
    }
  }
}
