import { Component, Input, OnChanges, OnDestroy, SimpleChanges, inject, signal, computed } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import dayjs, { type Dayjs } from 'dayjs';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTES, ActivityDeliverySource } from '@shared/activity-sync-routes';
import { HistoricalSendRequest, HistoricalSendResponse } from '@shared/historical-activity-send';
import { getProviderDisplayName } from '@shared/provider-presentation';
import { AppUserInterface } from '../../../models/app-user.interface';
import { AppUserService } from '../../../services/app.user.service';
import { AppHapticsService } from '../../../services/app.haptics.service';

interface SourceOption {
  id: ActivityDeliverySource;
  label: string;
  selected: boolean;
}

type SendSummary = Omit<HistoricalSendResponse, 'nextCursor'>;

interface PreviewExclusion {
  key: string;
  label: string;
  count: number;
}

const SOURCE_MISMATCH_REASONS = new Set(['not_imported_from_source', 'not_manual_upload']);
const PREVIEW_EXCLUSION_GROUPS = [
  { key: 'already_sent', label: 'Already sent', reasons: ['already_sent'] },
  { key: 'already_queued', label: 'Already queued', reasons: ['already_queued'] },
  { key: 'original_unavailable', label: 'Original file unavailable or unsupported',
    reasons: ['missing_original_files', 'unsupported_original_file', 'missing_invalid_or_oversized_original'] },
  { key: 'merged', label: 'Merged or derived activity', reasons: ['merged_or_derived_event'] },
  { key: 'delivery_review', label: 'Previous delivery needs review', reasons: ['manual_reconciliation_required'] },
  { key: 'invalid_event', label: 'Activity unavailable', reasons: ['invalid_event'] },
  { key: 'processing_failed', label: 'Couldn’t check', reasons: ['processing_failed'] },
] as const;

@Component({
  selector: 'app-historical-activity-send',
  templateUrl: './historical-activity-send.component.html',
  styleUrls: ['./historical-activity-send.component.scss'],
  standalone: false,
})
export class HistoricalActivitySendComponent implements OnChanges, OnDestroy {
  private static nextInstanceID = 0;
  readonly sendHintID = `historical-send-hint-${HistoricalActivitySendComponent.nextInstanceID++}`;
  @Input() user!: AppUserInterface;
  @Input() destinationServiceName!: ServiceNames;
  @Input() destinationConnected = false;
  @Input() hasProAccess = false;

  private readonly userService = inject(AppUserService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly haptics = inject(AppHapticsService);
  private destroyed = false;
  private revision = 0;
  private pickerDateSignature: string | null = null;

  // Material's app-wide adapter emits Dayjs values for both typing and calendar selection.
  readonly today = dayjs().startOf('day');
  startDate: Dayjs | null = this.today.subtract(30, 'day');
  endDate: Dayjs | null = this.today;
  sourceOptions: SourceOption[] = [];
  readonly busy = signal<'preview' | 'send' | null>(null);
  readonly preview = signal<SendSummary | null>(null);
  readonly sendResult = signal<SendSummary | null>(null);
  readonly previewSignature = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly progress = signal<SendSummary | null>(null);
  readonly progressEligibleCount = computed(() => Object.values(this.progress()?.eligibleBySource || {}).reduce((total, count) => total + count, 0));
  readonly previewEligibleCount = computed(() => Object.values(this.preview()?.eligibleBySource || {}).reduce((total, count) => total + count, 0));
  readonly previewExclusions = computed(() => {
    const summary = this.preview();
    const remaining = new Map(Object.entries(summary?.skippedByReason || {})
      .filter(([reason, count]) => count > 0 && !SOURCE_MISMATCH_REASONS.has(reason)));
    // Failure counts remain visible even if an older response omits its reason breakdown.
    if (summary?.failedCount) {
      remaining.set('processing_failed', Math.max(summary.failedCount, remaining.get('processing_failed') || 0));
    }
    const rows: PreviewExclusion[] = PREVIEW_EXCLUSION_GROUPS.map(group => {
      let count = 0;
      for (const reason of group.reasons) {
        count += remaining.get(reason) || 0;
        remaining.delete(reason);
      }
      return { key: group.key, label: group.label, count };
    }).filter(row => row.count > 0);
    const otherCount = [...remaining.values()].reduce((total, count) => total + count, 0);
    if (otherCount) rows.push({ key: 'other', label: 'Other exclusions', count: otherCount });
    return rows;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['destinationServiceName']) {
      this.sourceOptions = Object.values(ACTIVITY_SYNC_ROUTES)
        .filter(route => route.destinationServiceName === this.destinationServiceName)
        .map(route => ({
          id: route.sourceServiceName,
          label: `${getProviderDisplayName(route.sourceServiceName, 'source')} imports`,
          selected: false,
        }));
      this.sourceOptions.push({ id: 'manualUpload', label: 'Manual uploads', selected: false });
    }
    if (changes['destinationServiceName'] || changes['user']
      || changes['destinationConnected'] || changes['hasProAccess']) this.invalidate();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.revision += 1;
  }

  get selectedSourceCount(): number {
    return this.sourceOptions.filter(option => option.selected).length;
  }

  get dateRangeInvalid(): boolean {
    return !dayjs.isDayjs(this.startDate) || !this.startDate.isValid()
      || !dayjs.isDayjs(this.endDate) || !this.endDate.isValid()
      || this.startDate.isAfter(this.endDate, 'day') || this.endDate.isAfter(this.today, 'day');
  }

  get canPreview(): boolean {
    return !!this.user?.uid && this.hasProAccess && this.destinationConnected
      && this.selectedSourceCount > 0 && !this.dateRangeInvalid && !this.busy();
  }

  get canSend(): boolean {
    return this.canPreview && !!this.preview() && this.previewSignature() === this.signature()
      && this.previewEligibleCount() > 0;
  }

  get sendDisabledReason(): string | null {
    if (this.busy() || !this.user?.uid || !this.hasProAccess || !this.destinationConnected) return null;
    if (!this.selectedSourceCount) return 'Choose at least one source, then run Preview to enable Send.';
    if (this.dateRangeInvalid) return 'Choose valid dates, then run Preview to enable Send.';
    const summary = this.preview();
    if (!summary || this.previewSignature() !== this.signature()) return 'Run Preview to check which activities can be sent.';
    if (this.previewEligibleCount()) return null;
    const exclusions = this.previewExclusions();
    if (exclusions.some(row => row.key === 'processing_failed')) {
      return 'No activities are confirmed ready to send. Run Preview again to retry the checks that failed.';
    }
    if (!summary.scanned) return 'No activities found in these dates. Choose a different date range and run Preview again.';
    const destination = getProviderDisplayName(this.destinationServiceName, 'destination');
    if (exclusions.length && exclusions.every(row => row.key === 'already_sent' || row.key === 'already_queued')) {
      const status = exclusions.length > 1 ? `sent to or queued for ${destination}`
        : exclusions[0].key === 'already_sent' ? `sent to ${destination}` : `queued for ${destination}`;
      return `Nothing new to send: matching activities are already ${status}.`;
    }
    if (!exclusions.length && Object.entries(summary.skippedByReason).some(([reason, count]) =>
      count > 0 && SOURCE_MISMATCH_REASONS.has(reason))) {
      return 'No activities match the selected sources. Choose different sources or dates and run Preview again.';
    }
    return 'No activities are ready to send. Choose different sources or dates and run Preview again.';
  }

  onSourceChange(option: SourceOption, selected: boolean): void {
    if (option.selected === selected) return;
    option.selected = selected;
    this.haptics.selection();
    this.invalidate();
  }

  onDateInput(): void {
    this.invalidate();
  }

  onDatePickerOpened(): void {
    this.pickerDateSignature = this.dateSignature();
  }

  onDatePickerClosed(): void {
    const previous = this.pickerDateSignature;
    this.pickerDateSignature = null;
    if (previous !== null && previous !== this.dateSignature() && !this.dateRangeInvalid) {
      this.haptics.selection();
    }
  }

  async runPreview(): Promise<void> {
    if (!this.canPreview) return;
    this.haptics.selection();
    await this.run('preview');
  }

  async runSend(): Promise<void> {
    if (!this.canSend) return;
    this.haptics.selection();
    await this.run('send');
  }

  stopPreview(): void {
    if (this.busy() !== 'preview') return;
    this.haptics.selection();
    // The dispatched page is read-only; discard its reply and stop requesting further pages.
    this.invalidate();
  }

  private invalidate(): void {
    this.revision += 1;
    this.preview.set(null);
    this.previewSignature.set(null);
    this.sendResult.set(null);
    this.error.set(null);
    this.busy.set(null);
    this.progress.set(null);
  }

  private signature(): string {
    return JSON.stringify([
      this.user?.uid, this.destinationServiceName,
      this.sourceOptions.filter(option => option.selected).map(option => option.id),
      this.dateSignature(),
    ]);
  }

  private dateSignature(): string {
    return JSON.stringify([this.startDate?.format('YYYY-MM-DD'), this.endDate?.format('YYYY-MM-DD')]);
  }

  private request(action: 'preview' | 'send'): HistoricalSendRequest {
    const start = this.startDate!.startOf('day');
    const end = this.endDate!.endOf('day');
    return {
      version: 2,
      action,
      destinationServiceName: this.destinationServiceName,
      sources: this.sourceOptions.filter(option => option.selected).map(option => option.id),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    };
  }

  private async run(action: 'preview' | 'send'): Promise<void> {
    const revision = this.revision;
    const signature = this.signature();
    let request = this.request(action);
    const summary: SendSummary = { scanned: 0, eligibleBySource: {}, skippedBySource: {}, queued: 0, skippedByReason: {}, failedCount: 0 };
    if (action === 'preview') {
      this.preview.set(null);
      this.previewSignature.set(null);
      this.sendResult.set(null);
    }
    this.busy.set(action);
    this.error.set(null);
    this.progress.set({ ...summary });
    try {
      const seenCursors = new Set<string>();
      let hasNextPage = true;
      while (hasNextPage) {
        const page = await this.userService.historicalSendActivityPage(request);
        if (this.destroyed || this.revision !== revision) return;
        if (page.nextCursor) {
          const cursorKey = JSON.stringify([page.nextCursor.lastStartDate, page.nextCursor.lastEventID]);
          if (seenCursors.has(cursorKey)) throw new Error('Historical activity preview did not advance.');
          seenCursors.add(cursorKey);
        }
        summary.scanned += page.scanned;
        summary.queued += page.queued;
        summary.failedCount += page.failedCount;
        for (const [source, count] of Object.entries(page.eligibleBySource)) {
          summary.eligibleBySource[source] = (summary.eligibleBySource[source] || 0) + count;
        }
        for (const [source, count] of Object.entries(page.skippedBySource || {})) {
          summary.skippedBySource[source] = (summary.skippedBySource[source] || 0) + count;
        }
        for (const [reason, count] of Object.entries(page.skippedByReason)) {
          summary.skippedByReason[reason] = (summary.skippedByReason[reason] || 0) + count;
        }
        hasNextPage = !!page.nextCursor;
        this.progress.set({ ...summary });
        if (page.nextCursor) request = { ...request, cursor: page.nextCursor };
      }
      if (action === 'preview') {
        this.preview.set(summary);
        this.previewSignature.set(signature);
      } else {
        this.sendResult.set(summary);
        this.snackBar.open(`${summary.queued} activities scheduled for ${getProviderDisplayName(this.destinationServiceName, 'destination')}.`, undefined, { duration: 4500 });
      }
      if (summary.failedCount) this.haptics.warning();
      else this.haptics.success();
    } catch {
      if (this.destroyed || this.revision !== revision) return;
      if (action === 'send') this.sendResult.set(summary);
      this.error.set(action === 'preview' ? 'Could not preview past activities.'
        : `Scheduling stopped after ${summary.queued} activities. You can retry safely.`);
      this.haptics.error();
    } finally {
      if (!this.destroyed && this.revision === revision) {
        this.busy.set(null);
        this.progress.set(null);
      }
    }
  }
}
