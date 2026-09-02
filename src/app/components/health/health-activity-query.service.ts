import { Injectable, inject } from '@angular/core';
import type {
  ActivityHealthRangeRequest,
  ActivityHealthRangeResult,
} from '@shared/activity-health';
import { AppFunctionsService } from '../../services/app.functions.service';

/** Lazy Health-workspace adapter for the bounded workout evidence callable. */
@Injectable({ providedIn: 'root' })
export class HealthActivityQueryService {
  private readonly functions = inject(AppFunctionsService);

  async loadRange(request: ActivityHealthRangeRequest): Promise<ActivityHealthRangeResult> {
    const response = await this.functions.call<ActivityHealthRangeRequest, ActivityHealthRangeResult>(
      'queryActivityHealthRange',
      request,
    );
    return response.data;
  }
}
