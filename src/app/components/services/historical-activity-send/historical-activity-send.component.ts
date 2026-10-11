import { Component, Input, OnChanges, OnDestroy, SimpleChanges, inject } from '@angular/core';
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

@Component({
  selector: 'app-historical-activity-send',
  templateUrl: './historical-activity-send.component.html',
  styleUrls: ['./historical-activity-send.component.scss'],
  standalone: false,
})
export class HistoricalActivitySendComponent implements OnChanges, OnDestroy {
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
  busy: 'preview' | 'send' | null = null;
  preview: SendSummary | null = null;
  sendResult: SendSummary | null = null;
  previewSignature: string | null = null;
  error: string | null = null;

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
      && this.selectedSourceCount > 0 && !this.dateRangeInvalid && !this.busy;
  }

  get canSend(): boolean {
    return this.canPreview && !!this.preview && this.previewSignature === this.signature()
      && Object.values(this.preview.eligibleBySource).some(count => count > 0);
  }

  get previewSkippedCount(): number {
    return Object.values(this.preview?.skippedBySource || {}).reduce((total, count) => total + count, 0);
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

  private invalidate(): void {
    this.revision += 1;
    this.preview = null;
    this.previewSignature = null;
    this.sendResult = null;
    this.error = null;
    this.busy = null;
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
    const request = this.request(action);
    const summary: SendSummary = { scanned: 0, eligibleBySource: {}, skippedBySource: {}, queued: 0, skippedByReason: {}, failedCount: 0 };
    if (action === 'preview') {
      this.preview = null;
      this.previewSignature = null;
      this.sendResult = null;
    }
    this.busy = action;
    this.error = null;
    try {
      let hasNextPage = true;
      while (hasNextPage) {
        const page = await this.userService.historicalSendActivityPage(request);
        if (this.destroyed || this.revision !== revision) return;
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
        if (page.nextCursor) request.cursor = page.nextCursor;
      }
      if (action === 'preview') {
        this.preview = summary;
        this.previewSignature = signature;
      } else {
        this.sendResult = summary;
        this.snackBar.open(`${summary.queued} activities scheduled for ${getProviderDisplayName(this.destinationServiceName, 'destination')}.`, undefined, { duration: 4500 });
      }
      if (summary.failedCount) this.haptics.warning();
      else this.haptics.success();
    } catch {
      if (this.destroyed || this.revision !== revision) return;
      if (action === 'send') this.sendResult = summary;
      this.error = action === 'preview' ? 'Could not preview past activities.'
        : `Scheduling stopped after ${summary.queued} activities. You can retry safely.`;
      this.haptics.error();
    } finally {
      if (!this.destroyed && this.revision === revision) this.busy = null;
    }
  }
}
