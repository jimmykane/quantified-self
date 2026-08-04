import { Injectable, inject } from '@angular/core';
import type {
  AssistantQuotaStatus,
  AssistantQuotaStatusResponse,
} from '@shared/assistant.types';
import { AppFunctionsService } from './app.functions.service';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root',
})
export class AssistantQuotaService {
  private readonly functionsService = inject(AppFunctionsService);
  private readonly logger = inject(LoggerService);

  async loadQuotaStatus(): Promise<AssistantQuotaStatus | null> {
    try {
      const response = await this.functionsService.call<void, AssistantQuotaStatusResponse>('getAssistantQuotaStatus');
      return response.data;
    } catch (error) {
      this.logger.warn('[AssistantQuotaService] Failed to load Assistant quota status.', error);
      return null;
    }
  }
}
