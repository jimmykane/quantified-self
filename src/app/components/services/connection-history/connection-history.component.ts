import { Component, computed, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
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
  historyRangeOptions,
  type ConnectionHistoryRangePreset,
  type ConnectionHistoryStatusProjection,
  type HistoryResource,
} from '@shared/connection-history';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppUserService } from '../../../services/app.user.service';
import { RecordedHistoryStartService } from '../../../services/recorded-history-start.service';
import type { SleepProvider } from '@shared/sleep';
import type { ServiceConnectionState } from '@shared/service-connection';
import { buildHistoryImportItems } from '../../../helpers/history-import-progress.helper';
import { HistoryImportSummaryComponent } from '../../history-import-progress/history-import-summary.component';

const providers: Partial<Record<ServiceNames, SleepProvider>> = {
  [ServiceNames.GarminAPI]: 'GarminAPI', [ServiceNames.SuuntoApp]: 'SuuntoApp', [ServiceNames.COROSAPI]: 'COROSAPI',
};
interface StoredHistoryStart { resource: 'sleep' | 'health'; label: string; firstDate: string | null; unavailable: boolean; }

const labels: Record<HistoryResource, string> = { activities: 'activities', sleep: 'Sleep', health: 'Health', routes: 'saved routes' };
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
  readonly description = computed(() => `Includes ${resourceLabel([...new Set(historyCapabilities(this.service()).flatMap(capability => capability.resources))])} where supported. Importing happens in the background.${this.service() === ServiceNames.GarminAPI ? ' History availability varies by data type and Garmin account.' : ''}${this.service() === ServiceNames.SuuntoApp ? ' Saved routes include your entire Suunto route library, regardless of the history range.' : ''}`);
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
  imports: [DatePipe, NgTemplateOutlet, MatExpansionModule, MatButtonModule, MatProgressBarModule, HistoryImportSummaryComponent],
  templateUrl: './connection-history-status.component.html', styleUrl: './connection-history.component.scss' })
export class ConnectionHistoryStatusComponent {
  readonly service = input<ServiceNames>(ServiceNames.GarminAPI);
  readonly status = input<ConnectionHistoryStatusProjection | null>(null);
  readonly disabled = input(false);
  readonly inline = input(false);
  readonly connectionState = input<ServiceConnectionState | null>();
  readonly progressItem = computed(() => buildHistoryImportItems([{serviceName: this.service(),
    projection: this.status(), connectionState: this.connectionState()}])[0] ?? null);
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
  private readonly historyStarts = inject(RecordedHistoryStartService);
  private readonly destroyRef = inject(DestroyRef);
  readonly expanded = signal(false);
  readonly checkingHistory = signal(false);
  readonly storedHistory = signal<StoredHistoryStart[]>([]);
  readonly sleepCutoff = signal<number | null>(null);
  readonly cutoffUnavailable = signal(false);
  readonly storedHistoryTitleId = computed(() => `stored-history-${providers[this.service()] || 'other'}`);
  private readonly historyRefresh = signal(0);
  // Progress counters can update for every bounded import window. Only a changed run/resource scope needs a new check.
  private readonly historyScope = computed(() => JSON.stringify([this.status()?.runId,
    [...new Set(this.status()?.steps.flatMap(step => step.resources) || [])].sort()]));
  private historyVersion = 0;
  private historyController: AbortController | null = null;
  // Garmin/Suunto/Wahoo manual pickers submit local day boundaries; COROS uses UTC
  // calendar dates. Automatic connection ranges have always been UTC.
  readonly rangeTimezone = computed(() => this.status()?.rangePreset === 'custom'
    && (this.service() === ServiceNames.GarminAPI || this.service() === ServiceNames.SuuntoApp
      || this.service() === ServiceNames.WahooAPI) ? undefined : 'UTC');
  readonly isAllAvailableRange = computed(() => this.status()?.rangePreset === 'maximum'
    && (this.service() === ServiceNames.SuuntoApp || this.service() === ServiceNames.WahooAPI));
  readonly summary = computed(() => {
    return this.progressItem()?.label ?? 'Import status unavailable';
  });
  readonly steps = computed(() => (this.status()?.steps || []).map(step => ({ ...step,
    label: resourceLabel(step.resources),
  })));
  readonly needsReconnect = computed(() => this.connectionState() === 'reconnect_required'
    || this.steps().some(step => /reconnect|authorization|permission/i.test(step.message || '')));
  constructor() {
    effect(() => {
      const owner = this.users.user(), provider = providers[this.service()], expanded = this.inline() || this.expanded();
      this.connectionState();
      this.historyRefresh(); this.historyScope();
      untracked(() => { const status = this.progressItem() ? this.status() : null;
        void this.checkStoredHistory(expanded && owner && status ? owner.uid : null,
          provider, status?.steps.flatMap(step => step.resources) || []); });
    });
    this.destroyRef.onDestroy(() => { this.historyVersion++; this.historyController?.abort(); });
  }
  setExpanded(expanded: boolean): void {
    if (this.expanded() === expanded) return;
    this.haptics.selection(); this.expanded.set(expanded);
  }
  refreshStoredHistory(): void {
    if (!(this.inline() || this.expanded()) || this.checkingHistory()) return;
    this.haptics.selection(); this.checkingHistory.set(true); this.historyRefresh.update(value => value + 1);
  }
  private async checkStoredHistory(uid: string | null, provider: SleepProvider | undefined, resources: HistoryResource[]): Promise<void> {
    const version = ++this.historyVersion;
    this.historyController?.abort(); this.historyController = new AbortController();
    const signal = this.historyController.signal;
    this.storedHistory.set([]); this.sleepCutoff.set(null); this.cutoffUnavailable.set(false); this.checkingHistory.set(false);
    if (!uid || !provider) return;
    const requested = (['sleep', 'health'] as const).filter(resource => resources.includes(resource));
    if (!requested.length) return;
    this.checkingHistory.set(true);
    const [starts, cutoff] = await Promise.all([
      Promise.allSettled(requested.map(resource => resource === 'sleep'
        ? this.historyStarts.firstSleepDate(uid, provider, signal) : this.historyStarts.firstHealthDate(uid, provider, signal))),
      provider === 'GarminAPI' && requested.includes('sleep')
        ? this.historyStarts.lastReportedGarminSleepCutoff(uid, signal).then(value => ({ value, failed: false }), () => ({ value: null, failed: true }))
        : Promise.resolve({ value: null, failed: false }),
    ]);
    if (this.destroyRef.destroyed || version !== this.historyVersion || signal.aborted) return;
    this.storedHistory.set(requested.map((resource, index) => ({ resource, label: labels[resource],
      firstDate: starts[index].status === 'fulfilled' ? starts[index].value : null, unavailable: starts[index].status === 'rejected' })));
    this.sleepCutoff.set(cutoff.value); this.cutoffUnavailable.set(cutoff.failed); this.checkingHistory.set(false);
  }
  reviewReconnect(): void { if (!this.disabled()) { this.haptics.selection(); this.reconnect.emit(); } }
  private matchesCurrentRun(view: HistoryRetryView | null): boolean {
    return !!view && view.runId === this.progressItem()?.runId && view.service === this.service();
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
