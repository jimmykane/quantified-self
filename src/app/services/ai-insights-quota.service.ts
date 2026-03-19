import { Injectable, inject } from '@angular/core';
import type {
  AiInsightsQuotaStatus,
  AiInsightsQuotaStatusResponse,
} from '@shared/ai-insights.types';
import { AppFunctionsService } from './app.functions.service';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root',
})
export class AiInsightsQuotaService {
  private readonly functionsService = inject(AppFunctionsService);
  private readonly logger = inject(LoggerService);

  async loadQuotaStatus(): Promise<AiInsightsQuotaStatus | null> {
    try {
      const response = await this.functionsService.call<void, AiInsightsQuotaStatusResponse>('getAiInsightsQuotaStatus');
      return response.data;
    } catch (error) {
      this.logger.warn('[AiInsightsQuotaService] Failed to load AI Insights quota status.', error);
      return null;
    }
  }
}
