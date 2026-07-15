import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { AppEventInterface } from '@shared/app-event.interface';
import {
  User,
  ActivityInterface,
  UserUnitSettingsInterface,
  DataDistance,
  DataDuration,
  DataSpeedAvg,
  DataFeeling,
  DataRPE,
  Feelings,
  RPEBorgCR10SCale,
} from '@sports-alliance/sports-lib';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { EventDetailsSummaryBottomSheetComponent } from './event-details-summary-bottom-sheet/event-details-summary-bottom-sheet.component';
import { EventStatsBottomSheetComponent } from '../event/stats-table/event-stats-bottom-sheet/event-stats-bottom-sheet.component';
import { EventDevicesBottomSheetComponent } from '../event/devices/event-devices-bottom-sheet/event-devices-bottom-sheet.component';
import { AppBenchmarkFlowService } from '../../services/app.benchmark-flow.service';
import { resolvePrimaryUnitAwareDisplayStat, buildHeroMetric } from '../../helpers/summary-display.helper';
import { resolvePreferredSpeedDerivedAverageTypeForActivity } from '../../helpers/summary-stats.helper';
import { SummaryPrimaryInfoMetric } from '../shared/summary-primary-info/summary-primary-info.component';
import { EventDevicesService } from '../../services/event-devices.service';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { EventTagService } from '../../services/event-tag.service';
import { EventTagsDialogComponent } from '../event-tags/event-tags-dialog.component';

@Component({
  selector: 'app-event-summary',
  templateUrl: './event-summary.component.html',
  styleUrls: ['./event-summary.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventSummaryComponent implements OnChanges {
  @Input() event!: AppEventInterface;
  @Input() user!: User;
  @Input() showType = true;
  @Input() showIcon = false;
  @Input() isOwner = false;
  @Input() selectedActivities: ActivityInterface[] = [];
  @Input() unitSettings!: UserUnitSettingsInterface;
  @Input() statsToShow: string[] = [];

  // Local state for on-demand generated benchmark
  benchmarkResult: import('@shared/app-event.interface').BenchmarkResult | null = null;

  private heroStatLookup = new Map<string, { value: string; unit: string }>();
  private hasDevicesValue = false;
  private heroStatsValue: string[] = [];
  private heroEffortStatTypeValue: string = DataSpeedAvg.type;
  private eventActivitiesCountValue = 0;
  private mainActivityTypeValue = 'Other';
  private benchmarkCountValue = 0;
  private feelingValue: Feelings | null = null;
  private feelingLabelValue = '';
  private rpeValue: RPEBorgCR10SCale | null = null;
  private rpeLabelValue = '';
  private feelingIconValue = '';
  private showDeviceChipValue = false;
  private deviceChipLabelValue = '';
  private deviceChipTooltipValue = '';
  private deviceSourceSuppressedLabelsValue: readonly string[] = [];
  private cachedEventRef: AppEventInterface | null = null;
  private cachedSelectedActivitiesRef: ActivityInterface[] | null = null;
  private templateStateInitialized = false;
  private eventTagsValue: string[] = [];

  constructor(
    private cd: ChangeDetectorRef,
    private bottomSheet: MatBottomSheet,
    private benchmarkFlow: AppBenchmarkFlowService,
    private eventDevicesService: EventDevicesService,
    private dialog: MatDialog,
    private eventTagService: EventTagService,
  ) {
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['event'] || changes['selectedActivities']) {
      this.rebuildTemplateState();
    }
  }

  openEditDetails() {
    this.bottomSheet.open(EventDetailsSummaryBottomSheetComponent, {
      data: { event: this.event, user: this.user }
    });
  }

  openDetailedStats() {
    this.bottomSheet.open(EventStatsBottomSheetComponent, {
      data: {
        event: this.event,
        user: this.ownerMetadataLookupUser,
        selectedActivities: this.selectedActivities,
        userUnitSettings: this.unitSettings
      },
    });
  }

  get hasDevices(): boolean {
    this.ensureTemplateState();
    return this.hasDevicesValue;
  }

  get showDeviceChip(): boolean {
    this.ensureTemplateState();
    return this.showDeviceChipValue;
  }

  get deviceChipLabel(): string {
    this.ensureTemplateState();
    return this.deviceChipLabelValue;
  }

  get deviceChipTooltip(): string {
    this.ensureTemplateState();
    return this.deviceChipTooltipValue;
  }

  get deviceSourceSuppressedLabels(): readonly string[] {
    this.ensureTemplateState();
    return this.deviceSourceSuppressedLabelsValue;
  }

  get ownerMetadataLookupUser(): User | null {
    return this.isOwner ? this.user || null : null;
  }

  get eventTags(): string[] {
    this.ensureTemplateState();
    return this.eventTagsValue;
  }

  async openTags(): Promise<void> {
    if (!this.isOwner || !this.user || !this.event?.getID?.()) {
      return;
    }
    const targetEvent = this.event;
    const targetEventID = targetEvent.getID();
    const targetUser = this.user;
    const originalTags = this.eventTags;
    const dialogRef = this.dialog.open(EventTagsDialogComponent, {
      width: 'min(34rem, calc(100vw - 32px))',
      maxWidth: 'calc(100vw - 32px)',
      data: {
        title: 'Event tags',
        tags: originalTags,
        save: async (tags: string[]) => {
          const savedTags = await this.eventTagService.saveTags(targetUser, targetEvent, tags, originalTags);
          this.applySavedTagsToCurrentEvent(targetEventID, savedTags);
          return savedTags;
        },
      },
    });
    const savedTags = await firstValueFrom(dialogRef.afterClosed());
    if (!Array.isArray(savedTags)) {
      return;
    }
  }

  private applySavedTagsToCurrentEvent(targetEventID: string, savedTags: string[]): void {
    if (this.event?.getID?.() !== targetEventID) {
      return;
    }
    this.event.tags = savedTags;
    delete this.event.benchmarkReviewTags;
    this.rebuildTemplateState();
    this.cd.markForCheck();
  }

  get heroStats(): string[] {
    this.ensureTemplateState();
    return this.heroStatsValue;
  }

  get eventActivitiesCount(): number {
    this.ensureTemplateState();
    return this.eventActivitiesCountValue;
  }

  openDevices() {
    this.bottomSheet.open(EventDevicesBottomSheetComponent, {
      data: {
        event: this.event,
        selectedActivities: this.selectedActivities,
      },
    });
  }

  async openBenchmark() {
    const targetEvent = this.event;
    const targetEventID = targetEvent.getID();
    await this.benchmarkFlow.openBenchmarkEntry({
      event: targetEvent,
      user: this.user,
      initialSelection: this.selectedActivities,
      onResult: (result) => {
        this.benchmarkResult = result;
        this.rebuildTemplateState();
        this.cd.detectChanges();
      },
      onEventTagsSaved: (tags) => this.applySavedTagsToCurrentEvent(targetEventID, tags),
    });
  }

  openBenchmarkDialog(): void {
    const targetEvent = this.event;
    const targetEventID = targetEvent.getID();
    this.benchmarkFlow.openBenchmarkSelectionDialog({
      event: targetEvent,
      user: this.user,
      initialSelection: this.selectedActivities,
      onResult: (result) => {
        this.benchmarkResult = result;
        this.rebuildTemplateState();
        this.cd.detectChanges();
      },
      onEventTagsSaved: (tags) => this.applySavedTagsToCurrentEvent(targetEventID, tags),
    });
  }

  get mainActivityType(): string {
    this.ensureTemplateState();
    return this.mainActivityTypeValue;
  }

  get heroSummaryMetrics(): SummaryPrimaryInfoMetric[] {
    this.ensureTemplateState();
    return this.heroStatsValue.map((statType) =>
      buildHeroMetric(statType, this.event?.getStat(statType), this.unitSettings, [this.mainActivityTypeValue])
    );
  }

  get benchmarkCount(): number {
    this.ensureTemplateState();
    return this.benchmarkCountValue;
  }

  getHeroStats(): string[] {
    return this.heroStats;
  }

  getStatValue(statType: string): string {
    this.ensureTemplateState();
    const cachedStat = this.heroStatLookup.get(statType);
    if (cachedStat) {
      return cachedStat.value;
    }
    const stat = this.event?.getStat(statType);
    const unitAware = resolvePrimaryUnitAwareDisplayStat(stat, this.unitSettings, statType, [this.mainActivityTypeValue]);
    return unitAware ? unitAware.value : '--';
  }

  getStatUnit(statType: string): string {
    this.ensureTemplateState();
    const cachedStat = this.heroStatLookup.get(statType);
    if (cachedStat) {
      return cachedStat.unit;
    }
    const stat = this.event?.getStat(statType);
    const unitAware = resolvePrimaryUnitAwareDisplayStat(stat, this.unitSettings, statType, [this.mainActivityTypeValue]);
    return unitAware ? unitAware.unit : '';
  }

  get feeling(): Feelings | null {
    this.ensureTemplateState();
    return this.feelingValue;
  }

  get feelingLabel(): string {
    this.ensureTemplateState();
    return this.feelingLabelValue;
  }

  get rpe(): RPEBorgCR10SCale | null {
    this.ensureTemplateState();
    return this.rpeValue;
  }

  get rpeLabel(): string {
    this.ensureTemplateState();
    return this.rpeLabelValue;
  }

  get feelingIcon(): string {
    this.ensureTemplateState();
    return this.feelingIconValue;
  }

  private rebuildTemplateState(): void {
    const activities = this.event?.getActivities?.() ?? [];
    const selectedActivities = this.selectedActivities?.length
      ? this.selectedActivities
      : activities;
    this.eventActivitiesCountValue = activities.length;
    this.mainActivityTypeValue = activities[0]?.type || 'Other';
    this.heroEffortStatTypeValue = resolvePreferredSpeedDerivedAverageTypeForActivity(this.mainActivityTypeValue) || DataSpeedAvg.type;
    this.heroStatsValue = this.resolveHeroStats(this.mainActivityTypeValue);
    this.heroStatLookup = this.buildHeroStatLookup();
    this.hasDevicesValue = selectedActivities.some((activity) => this.hasActivityDeviceDetails(activity));
    const eventDeviceNamesAsString = this.getEventDeviceNamesAsString();
    const selectedActivityDeviceNames = this.resolveSelectedActivityDeviceNames(selectedActivities);
    const hasEventDeviceNames = !!eventDeviceNamesAsString;
    this.showDeviceChipValue = hasEventDeviceNames || selectedActivityDeviceNames.length > 0 || this.hasDevicesValue;
    this.deviceChipLabelValue = hasEventDeviceNames
      ? eventDeviceNamesAsString
      : (selectedActivityDeviceNames.length <= 1
        ? (selectedActivityDeviceNames[0] || (this.hasDevicesValue ? 'Device' : ''))
        : `${selectedActivityDeviceNames.length} devices`);
    this.deviceChipTooltipValue = hasEventDeviceNames
      ? eventDeviceNamesAsString
      : (selectedActivityDeviceNames.length > 0
        ? selectedActivityDeviceNames.join('\n')
        : (this.hasDevicesValue ? 'Device details available' : ''));
    this.deviceSourceSuppressedLabelsValue = this.deviceChipLabelValue ? [this.deviceChipLabelValue] : [];
    this.benchmarkCountValue = this.event?.benchmarkResults ? Object.keys(this.event.benchmarkResults).length : 0;
    this.eventTagsValue = this.eventTagService.getTags(this.event);

    const feelingStat = this.event?.getStat(DataFeeling.type) as DataFeeling;
    this.feelingValue = feelingStat ? feelingStat.getValue() as Feelings : null;
    this.feelingLabelValue = this.feelingValue === null ? '' : (Feelings[this.feelingValue] || '');
    this.feelingIconValue = this.resolveFeelingIcon(this.feelingValue);

    const rpeStat = this.event?.getStat(DataRPE.type) as DataRPE;
    this.rpeValue = rpeStat ? rpeStat.getValue() as RPEBorgCR10SCale : null;
    this.rpeLabelValue = this.rpeValue === null ? '' : (RPEBorgCR10SCale[this.rpeValue] || '');
    this.cachedEventRef = this.event;
    this.cachedSelectedActivitiesRef = this.selectedActivities;
    this.templateStateInitialized = true;
  }

  private resolveHeroStats(_type: string): string[] {
    return [
      DataDuration.type,
      DataDistance.type,
      this.heroEffortStatTypeValue || DataSpeedAvg.type,
    ];
  }

  private buildHeroStatLookup(): Map<string, { value: string; unit: string }> {
    const lookup = new Map<string, { value: string; unit: string }>();
    this.heroStatsValue.forEach((statType) => {
      const stat = this.event?.getStat(statType);
      const unitAware = resolvePrimaryUnitAwareDisplayStat(stat, this.unitSettings, statType, [this.mainActivityTypeValue]);
      lookup.set(statType, {
        value: unitAware ? unitAware.value : '--',
        unit: unitAware ? unitAware.unit : '',
      });
    });
    return lookup;
  }

  private resolveFeelingIcon(feeling: Feelings | null): string {
    if (feeling === null) return '';
    const iconMap: { [key: number]: string } = {
      [Feelings.Excellent]: 'sentiment_very_satisfied',
      [Feelings['Very Good']]: 'sentiment_satisfied',
      [Feelings.Good]: 'mood',
      [Feelings.Average]: 'sentiment_neutral',
      [Feelings.Poor]: 'sentiment_dissatisfied',
    };
    return iconMap[feeling] || '';
  }

  private resolveSelectedActivityDeviceNames(activities: ActivityInterface[]): string[] {
    const uniqueDeviceNames = new Set<string>();
    activities.forEach((activity) => {
      const deviceName = this.resolveActivityDeviceName(activity);
      if (deviceName) {
        uniqueDeviceNames.add(deviceName);
      }
    });

    return [...uniqueDeviceNames.values()];
  }

  private resolveActivityDeviceName(activity: ActivityInterface): string {
    const creatorName = `${activity?.creator?.name || ''}`.trim();
    const swInfo = `${activity?.creator?.swInfo || ''}`.trim();
    const creatorLabel = swInfo ? `${creatorName} ${swInfo}`.trim() : creatorName;
    if (creatorLabel) {
      return creatorLabel;
    }

    const creatorDevices = activity?.creator?.devices;
    if (Array.isArray(creatorDevices) && creatorDevices.length > 0) {
      const groupedDeviceName = this.eventDevicesService
        .getDeviceGroups(activity)
        .map((group) => `${group.displayName || ''}`.trim())
        .find((name) => !!name);
      if (groupedDeviceName) {
        return groupedDeviceName;
      }
    }

    const fallbackDeviceName = (Array.isArray(creatorDevices) ? creatorDevices : [])
      .map((device) => `${device?.name || device?.manufacturer || device?.type || ''}`.trim())
      .find((name) => !!name);

    return fallbackDeviceName || '';
  }

  private hasActivityDeviceDetails(activity: ActivityInterface): boolean {
    const creatorDevices = activity?.creator?.devices;
    return Array.isArray(creatorDevices) && creatorDevices.length > 0;
  }

  private getEventDeviceNamesAsString(): string {
    const sourceEvent = this.event as AppEventInterface & { getDeviceNamesAsString?: () => string };
    if (!sourceEvent || typeof sourceEvent.getDeviceNamesAsString !== 'function') {
      return '';
    }

    try {
      return `${sourceEvent.getDeviceNamesAsString() || ''}`.trim();
    } catch {
      return '';
    }
  }

  private ensureTemplateState(): void {
    if (!this.templateStateInitialized || this.cachedEventRef !== this.event || this.cachedSelectedActivitiesRef !== this.selectedActivities) {
      this.rebuildTemplateState();
    }
  }
}
