import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AppThemes, type ActivityTypes } from '@sports-alliance/sports-lib';
import type {
  AiInsightsEmptyResponse,
  AiInsightsOkResponse,
  AiInsightsRequest,
  AiInsightsResponse,
  AiInsightsUnsupportedResponse,
  NormalizedInsightDateRange,
} from '@shared/ai-insights.types';
import { MaterialModule } from '../../modules/material.module';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { AiInsightsService } from '../../services/ai-insights.service';
import { AiInsightsChartComponent } from './ai-insights-chart.component';

const DEFAULT_SUGGESTED_PROMPTS = [
  'Tell me my avg cadence for cycling the last 3 months',
  'Show my total distance by activity type this year',
  'What was my highest average heart rate last month',
  'Show my average pace for running over the last 90 days',
];

function getClientTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function getClientLocale(): string | undefined {
  if (typeof navigator === 'undefined') {
    return undefined;
  }

  return navigator.languages?.[0] || navigator.language || undefined;
}

function formatDateRange(dateRange: NormalizedInsightDateRange): string {
  return `${dateRange.startDate.slice(0, 10)} to ${dateRange.endDate.slice(0, 10)}`;
}

function formatActivitySummary(activityTypes: ActivityTypes[]): string {
  if (!activityTypes.length) {
    return 'All activities';
  }

  if (activityTypes.length === 1) {
    return activityTypes[0];
  }

  return `${activityTypes.length} activity types`;
}

@Component({
  selector: 'app-ai-insights-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    MaterialModule,
    AiInsightsChartComponent,
  ],
  templateUrl: './ai-insights-page.component.html',
  styleUrls: ['./ai-insights-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiInsightsPageComponent {
  private readonly aiInsightsService = inject(AiInsightsService);
  private readonly themeService = inject(AppThemeService);
  private readonly userSettingsQueryService = inject(AppUserSettingsQueryService);

  readonly promptControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  readonly promptValue = toSignal(this.promptControl.valueChanges, {
    initialValue: this.promptControl.getRawValue(),
  });
  readonly isSubmitting = signal(false);
  readonly response = signal<AiInsightsResponse | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly appTheme = this.themeService.appTheme;
  readonly chartSettings = this.userSettingsQueryService.chartSettings;
  readonly isDarkTheme = computed(() => this.appTheme() === AppThemes.Dark);
  readonly useAnimations = computed(() => this.chartSettings().useAnimations ?? false);
  readonly canSubmit = computed(() => !this.isSubmitting() && this.promptValue().trim().length > 0);
  readonly okResponse = computed<AiInsightsOkResponse | null>(() => {
    const response = this.response();
    return response?.status === 'ok' ? response : null;
  });
  readonly emptyResponse = computed<AiInsightsEmptyResponse | null>(() => {
    const response = this.response();
    return response?.status === 'empty' ? response : null;
  });
  readonly unsupportedResponse = computed<AiInsightsUnsupportedResponse | null>(() => {
    const response = this.response();
    return response?.status === 'unsupported' ? response : null;
  });
  readonly suggestedPrompts = computed(() => {
    const unsupportedResponse = this.unsupportedResponse();
    if (unsupportedResponse?.suggestedPrompts?.length) {
      return unsupportedResponse.suggestedPrompts;
    }
    return DEFAULT_SUGGESTED_PROMPTS;
  });
  readonly resultSubtitle = computed(() => {
    const response = this.okResponse() || this.emptyResponse();
    if (!response) {
      return '';
    }

    return `${formatDateRange(response.query.dateRange)} • ${formatActivitySummary(response.query.activityTypes)}`;
  });
  readonly resultWarnings = computed(() => this.okResponse()?.presentation.warnings ?? []);

  onFormSubmit(event: SubmitEvent | Event): void {
    event.preventDefault();
    void this.submitPrompt();
  }

  async submitPrompt(promptOverride?: string): Promise<void> {
    const prompt = `${promptOverride ?? this.promptControl.getRawValue()}`.trim();
    if (!prompt) {
      this.promptControl.markAsTouched();
      return;
    }

    if (prompt !== this.promptControl.getRawValue()) {
      this.promptControl.setValue(prompt);
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.response.set(null);

    try {
      const response = await this.aiInsightsService.runInsight(this.buildInsightRequest(prompt));
      this.response.set(response);
    } catch (error) {
      this.errorMessage.set(this.aiInsightsService.getErrorMessage(error));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async applySuggestedPrompt(prompt: string): Promise<void> {
    this.promptControl.setValue(prompt);
    await this.submitPrompt(prompt);
  }

  private buildInsightRequest(prompt: string): AiInsightsRequest {
    return {
      prompt,
      clientTimezone: getClientTimeZone(),
      clientLocale: getClientLocale(),
    };
  }
}
