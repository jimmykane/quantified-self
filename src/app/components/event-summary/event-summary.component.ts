import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { AppEventInterface, BenchmarkOptions, getBenchmarkPairKey } from '@shared/app-event.interface';
import {
  User,
  ActivityInterface,
  UserUnitSettingsInterface,
  Privacy,
  DataDistance,
  DataDuration,
  DataSpeedAvg,
  DataFeeling,
  DataRPE,
  Feelings,
  RPEBorgCR10SCale,
} from '@sports-alliance/sports-lib';
import { AppEventService } from '../../services/app.event.service';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { EventDetailsSummaryBottomSheetComponent } from './event-details-summary-bottom-sheet/event-details-summary-bottom-sheet.component';
import { EventStatsBottomSheetComponent } from '../event/stats-table/event-stats-bottom-sheet/event-stats-bottom-sheet.component';
import { EventDevicesBottomSheetComponent } from '../event/devices/event-devices-bottom-sheet/event-devices-bottom-sheet.component';
import { AppBenchmarkFlowService } from '../../services/app.benchmark-flow.service';
import { resolvePrimaryUnitAwareDisplayStat, buildHeroMetric } from '../../helpers/summary-display.helper';
import { resolvePreferredSpeedDerivedAverageTypeForActivity } from '../../helpers/summary-stats.helper';
import { SummaryPrimaryInfoMetric } from '../shared/summary-primary-info/summary-primary-info.component';

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
  private cachedEventRef: AppEventInterface | null = null;
  private cachedSelectedActivitiesRef: ActivityInterface[] | null = null;
  private templateStateInitialized = false;

  constructor(
    private eventService: AppEventService,
    private cd: ChangeDetectorRef,
    private bottomSheet: MatBottomSheet,
    private benchmarkFlow: AppBenchmarkFlowService
  ) {
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['event'] || changes['selectedActivities']) {
      this.rebuildTemplateState();
    }
  }

  async toggleEventPrivacy() {
    const eventID = this.event.getID();
    if (!this.user || !eventID) {
      return
    }
    // Optimistically toggle locally
    this.event.privacy = this.event.privacy === Privacy.Private ? Privacy.Public : Privacy.Private;
    this.cd.markForCheck(); // Trigger detection immediately

    // Then call service
    await this.eventService.setEventPrivacy(this.user, eventID, this.event.privacy);
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
        selectedActivities: this.selectedActivities,
        userUnitSettings: this.unitSettings
      },
    });
  }

  get hasDevices(): boolean {
    this.ensureTemplateState();
    return this.hasDevicesValue;
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
    const activities = this.event.getActivities();

    // For 2 activities, check if we have a saved result for this pair
    if (activities.length === 2) {
      const referenceID = activities[0].getID();
      const testID = activities[1].getID();
      if (!referenceID || !testID) {
        return;
      }
      const key = getBenchmarkPairKey(referenceID, testID);
      const savedResult = this.event.benchmarkResults?.[key];
      if (savedResult) {
        this.benchmarkResult = savedResult;
        this.openBenchmarkReport();
        return;
      }
      // No saved result, auto-run
      await this.runBenchmark(activities[0], activities[1], { autoAlignTime: true });
      return;
    }

    // For 3+ activities or to select different pair, open dialog
    this.openBenchmarkDialog();
  }

  openBenchmarkDialog(): void {
    this.benchmarkFlow.openBenchmarkSelectionDialog({
      event: this.event,
      user: this.user,
      initialSelection: this.selectedActivities,
      onResult: (result) => {
        this.benchmarkResult = result;
        this.rebuildTemplateState();
        this.cd.detectChanges();
      }
    });
  }

  private async runBenchmark(ref: ActivityInterface, test: ActivityInterface, options: BenchmarkOptions) {
    await this.benchmarkFlow.generateAndOpenReport({
      event: this.event,
      user: this.user,
      ref,
      test,
      options,
      initialSelection: this.selectedActivities,
      onResult: (result) => {
        this.benchmarkResult = result;
        this.rebuildTemplateState();
        this.cd.detectChanges();
      }
    });
  }

  openBenchmarkReport() {
    if (!this.benchmarkResult) return;
    this.benchmarkFlow.openBenchmarkReport({
      event: this.event,
      user: this.user,
      result: this.benchmarkResult,
      initialSelection: this.selectedActivities,
      onResult: (result) => {
        this.benchmarkResult = result;
        this.rebuildTemplateState();
        this.cd.detectChanges();
      }
    });
  }

  get mainActivityType(): string {
    this.ensureTemplateState();
    return this.mainActivityTypeValue;
  }

  get heroSummaryMetrics(): SummaryPrimaryInfoMetric[] {
    this.ensureTemplateState();
    return this.heroStatsValue.map((statType) =>
      buildHeroMetric(statType, this.event?.getStat(statType), this.unitSettings)
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
    const unitAware = resolvePrimaryUnitAwareDisplayStat(stat, this.unitSettings, statType);
    return unitAware ? unitAware.value : '--';
  }

  getStatUnit(statType: string): string {
    this.ensureTemplateState();
    const cachedStat = this.heroStatLookup.get(statType);
    if (cachedStat) {
      return cachedStat.unit;
    }
    const stat = this.event?.getStat(statType);
    const unitAware = resolvePrimaryUnitAwareDisplayStat(stat, this.unitSettings, statType);
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
    this.eventActivitiesCountValue = activities.length;
    this.mainActivityTypeValue = activities[0]?.type || 'Other';
    this.heroEffortStatTypeValue = resolvePreferredSpeedDerivedAverageTypeForActivity(this.mainActivityTypeValue) || DataSpeedAvg.type;
    this.heroStatsValue = this.resolveHeroStats(this.mainActivityTypeValue);
    this.heroStatLookup = this.buildHeroStatLookup();
    this.hasDevicesValue = this.selectedActivities?.some(a =>
      a.creator?.devices?.some(d => d.name || d.manufacturer)
    ) ?? false;
    this.benchmarkCountValue = this.event?.benchmarkResults ? Object.keys(this.event.benchmarkResults).length : 0;

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
      const unitAware = resolvePrimaryUnitAwareDisplayStat(stat, this.unitSettings, statType);
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

  private ensureTemplateState(): void {
    if (!this.templateStateInitialized || this.cachedEventRef !== this.event || this.cachedSelectedActivitiesRef !== this.selectedActivities) {
      this.rebuildTemplateState();
    }
  }
}
