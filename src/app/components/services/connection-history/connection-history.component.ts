import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  CONNECTION_HISTORY_DEFAULT_RANGE,
  historyCapabilities,
  historyRangeLabel,
  historyRangeOptions,
  type ConnectionHistoryRangePreset,
  type ConnectionHistoryStatusProjection,
  type HistoryResource,
} from '@shared/connection-history';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppUserService } from '../../../services/app.user.service';

const labels: Record<HistoryResource, string> = { activities: 'activities', sleep: 'Sleep', health: 'Health' };
interface HistoryRetryView { runId: string; service: ServiceNames; }
function resourceLabel(resources: readonly HistoryResource[]): string {
  return resources.map(resource => labels[resource]).join(', ').replace(/, ([^,]*)$/, ', and $1');
}
@Component({ selector: 'app-connection-history-option', standalone: true, imports: [MatCheckboxModule, MatFormFieldModule, MatSelectModule],
  templateUrl: './connection-history-option.component.html', styleUrl: './connection-history.component.scss' })
export class ConnectionHistoryOptionComponent {
  readonly service = input<ServiceNames>(ServiceNames.GarminAPI);
  readonly checked = input(true);
  readonly range = input<ConnectionHistoryRangePreset>(CONNECTION_HISTORY_DEFAULT_RANGE);
  readonly disabled = input(false);
  readonly checkedChange = output<boolean>();
  readonly rangeChange = output<ConnectionHistoryRangePreset>();
  private readonly haptics = inject(AppHapticsService);
  readonly description = computed(() => `Includes ${resourceLabel([...new Set(historyCapabilities(this.service()).flatMap(capability => capability.resources))])} where supported. Importing happens in the background.`);
  readonly rangeOptions = computed(() => historyRangeOptions(this.service()));
  change(checked: boolean): void {
    if (this.disabled() || this.checked() === checked) return;
    this.haptics.selection(); this.checkedChange.emit(checked);
  }
  changeRange(range: ConnectionHistoryRangePreset): void {
    if (this.disabled() || !this.checked() || this.range() === range
      || !this.rangeOptions().some(option => option.value === range)) return;
    this.haptics.selection(); this.rangeChange.emit(range);
  }
}
@Component({ selector: 'app-connection-history-status', standalone: true,
  imports: [DatePipe, MatExpansionModule, MatButtonModule, MatProgressBarModule],
  templateUrl: './connection-history-status.component.html', styleUrl: './connection-history.component.scss' })
export class ConnectionHistoryStatusComponent {
  readonly service = input<ServiceNames>(ServiceNames.GarminAPI);
  readonly status = input<ConnectionHistoryStatusProjection | null>(null);
  readonly disabled = input(false);
  readonly reconnect = output<void>();
  private readonly pendingRetry = signal<HistoryRetryView | null>(null);
  private readonly retryFailure = signal<(HistoryRetryView & { message: string }) | null>(null);
  readonly retrying = computed(() => this.matchesCurrentRun(this.pendingRetry()));
  readonly error = computed(() => {
    const failure = this.retryFailure();
    return this.matchesCurrentRun(failure) ? failure!.message : '';
  });
  readonly haptics = inject(AppHapticsService);
  private readonly users = inject(AppUserService);
  private readonly destroyRef = inject(DestroyRef);
  readonly rangeLabel = computed(() => {
    const status = this.status();
    return status ? historyRangeLabel(this.service(), status.rangePreset) : '';
  });
  readonly isAllAvailableRange = computed(() => this.status()?.rangePreset === 'maximum'
    && (this.service() === ServiceNames.SuuntoApp || this.service() === ServiceNames.WahooAPI));
  readonly summary = computed(() => {
    const status = this.status();
    if (status?.active) return 'Your selected history is importing in the background. You can keep using the app or close this page.';
    if (status?.steps.some(step => step.status === 'failed' || step.status === 'skipped')) return 'Some history needs attention. Expand for details.';
    if (status?.steps.some(step => step.status === 'requested')) return 'History requested; data may take hours or days to arrive.';
    return 'Selected history has been processed.';
  });
  readonly steps = computed(() => (this.status()?.steps || []).map(step => ({ ...step,
    label: resourceLabel(step.resources),
    description: ({ queued: 'Queued for background processing', requesting: 'Requesting history', retrying: 'Waiting to retry',
      requested: 'History requested; data may take hours or days to arrive.', processed: 'Processed', skipped: 'Skipped', failed: 'Failed' })[step.status],
  })));
  readonly needsReconnect = computed(() => this.steps().some(step => /reconnect|authorization|permission/i.test(step.message || '')));
  reviewReconnect(): void { if (!this.disabled()) { this.haptics.selection(); this.reconnect.emit(); } }
  private matchesCurrentRun(view: HistoryRetryView | null): boolean {
    return !!view && view.runId === this.status()?.runId && view.service === this.service();
  }
  async retry(): Promise<void> {
    const status = this.status();
    if (this.destroyRef.destroyed || !status?.canRetry || this.disabled() || this.retrying()) return;
    const view = { runId: status.runId, service: this.service() };
    const isCurrentView = () => !this.destroyRef.destroyed
      && this.pendingRetry() === view && this.matchesCurrentRun(view);
    this.haptics.selection(); this.pendingRetry.set(view); this.retryFailure.set(null);
    try {
      await this.users.retryConnectionHistoryImport(status.runId, isCurrentView);
      if (isCurrentView()) this.haptics.success();
    } catch (error) {
      const cancelled = error as { code?: unknown; message?: unknown } | null;
      if (!isCurrentView() || (cancelled?.code === undefined
        && cancelled?.message === 'Operation cancelled because its account or view changed.')) return;
      this.retryFailure.set({ ...view, message: 'Could not retry this import. Please try again, or reconnect if your authorization has changed.' });
      this.haptics.error();
    } finally {
      if (!this.destroyRef.destroyed && this.pendingRetry() === view) this.pendingRetry.set(null);
    }
  }
}
