import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, ChangeDetectorRef, computed } from '@angular/core';
import { AppEventInterface, BenchmarkOptions } from '../../../../functions/src/shared/app-event.interface';
import {
  EventInterface,
  User,
  ActivityInterface,
  UserUnitSettingsInterface,
  Privacy,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataPowerAvg,
  DataFeeling,
  DataRPE,
  Feelings,
  RPEBorgCR10SCale,
  ActivityTypes,
  ActivityTypesHelper,
  ActivityTypeGroups,
  ServiceNames,
} from '@sports-alliance/sports-lib';
import { AppEventService } from '../../services/app.event.service';
import { AppBenchmarkService } from '../../services/app.benchmark.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { EventDetailsSummaryBottomSheetComponent } from './event-details-summary-bottom-sheet/event-details-summary-bottom-sheet.component';
import { EventStatsBottomSheetComponent } from '../event/stats-table/event-stats-bottom-sheet/event-stats-bottom-sheet.component';
import { EventDevicesBottomSheetComponent } from '../event/devices/event-devices-bottom-sheet/event-devices-bottom-sheet.component';
import { BenchmarkBottomSheetComponent } from '../benchmark/benchmark-bottom-sheet.component';
import { BenchmarkSelectionDialogComponent } from '../benchmark/benchmark-selection-dialog.component';

@Component({
  selector: 'app-event-summary',
  templateUrl: './event-summary.component.html',
  styleUrls: ['./event-summary.component.css'],
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
  benchmarkResult: import('../../../../functions/src/shared/app-event.interface').BenchmarkResult | null = null;

  constructor(
    private eventService: AppEventService,
    private benchmarkService: AppBenchmarkService,
    private snackBar: MatSnackBar,
    private cd: ChangeDetectorRef,
    private bottomSheet: MatBottomSheet,
    private dialog: MatDialog
  ) {
  }

  ngOnChanges(changes: SimpleChanges): void {
  }

  async toggleEventPrivacy() {
    if (!this.user || !this.event.getID()) {
      return
    }
    // Optimistically toggle locally
    this.event.privacy = this.event.privacy === Privacy.Private ? Privacy.Public : Privacy.Private;
    this.cd.markForCheck(); // Trigger detection immediately

    // Then call service
    await this.eventService.setEventPrivacy(this.user, this.event.getID()!, this.event.privacy);
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
      panelClass: 'qs-full-width-bottom-sheet'
    });
  }

  get hasDevices(): boolean {
    return this.selectedActivities?.some(a =>
      a.creator?.devices?.some(d => d.name || d.manufacturer)
    ) ?? false;
  }

  openDevices() {
    this.bottomSheet.open(EventDevicesBottomSheetComponent, {
      data: {
        event: this.event,
        selectedActivities: this.selectedActivities,
      },
      panelClass: 'qs-full-width-bottom-sheet'
    });
  }

  async openBenchmark() {
    // 1. If we already have a result (persisted or local), open it.
    if (this.event.benchmarkResult) {
      this.benchmarkResult = this.event.benchmarkResult;
      this.openBenchmarkReport();
      return;
    }

    // 2. If we have exactly 2 activities, auto-run.
    const activities = this.event.getActivities();
    if (activities.length === 2) {
      await this.runBenchmark(activities[0], activities[1], { autoAlignTime: true });
      return;
    }

    // 3. Otherwise (or if force-triggered), open dialog.
    this.openBenchmarkDialog();
  }

  openBenchmarkDialog(): void {
    console.log('openBenchmarkDialog called');
    const activities = this.event?.getActivities() || [];
    console.log('Activities available:', activities.length, activities.map(a => a.creator?.name));

    const dialogRef = this.dialog.open(BenchmarkSelectionDialogComponent, {
      width: '600px',
      data: {
        activities: activities,
        initialSelection: this.selectedActivities
      }
    });

    dialogRef.afterClosed().subscribe(async (result: { activities: ActivityInterface[], options: BenchmarkOptions } | undefined) => {
      console.log('Dialog closed with result:', result);
      if (result && result.activities && result.activities.length === 2) {
        await this.runBenchmark(result.activities[0], result.activities[1], result.options);
      }
    });
  }

  private async runBenchmark(ref: ActivityInterface, test: ActivityInterface, options: BenchmarkOptions) {
    try {
      this.snackBar.open('Generating Benchmark...', undefined, { duration: 2000 });

      // Generate
      const result = await this.benchmarkService.generateBenchmark(ref, test, options);

      this.benchmarkResult = result;
      // Optimistically update local event
      this.event.benchmarkResult = result;
      this.cd.detectChanges();

      // Open Report immediately
      this.openBenchmarkReport();
      this.snackBar.open('Benchmark Generated & Saved!', undefined, { duration: 2000 });

      // Persist to Event
      // We perform this in background.
      if (this.user && this.event.getID()) {
        try {
          await this.eventService.updateEventProperties(this.user, this.event.getID()!, {
            benchmarkResult: result
          });
          console.log('Benchmark result persisted to event.');
        } catch (e) {
          console.error('Failed to persist benchmark result', e);
          // Non-blocking error, user still sees report
        }
      }

    } catch (error) {
      console.error(error);
      this.snackBar.open('Benchmark failed: ' + error, 'Close');
    }
  }

  openBenchmarkReport() {
    if (!this.benchmarkResult) return;

    const sheetRef = this.bottomSheet.open(BenchmarkBottomSheetComponent, {
      data: {
        result: this.benchmarkResult,
      },
      panelClass: 'qs-full-width-bottom-sheet'
    });

    sheetRef.afterDismissed().subscribe((result: { rerun?: boolean } | undefined) => {
      console.log('Bottom sheet dismissed with result:', result);
      if (result?.rerun) {
        console.log('Re-run triggered, opening dialog...');
        this.openBenchmarkDialog();
      }
    });
  }

  get mainActivityType(): string {
    return this.event?.getActivities()[0]?.type || 'Other';
  }

  getHeroStats(): string[] {
    const type = this.mainActivityType;
    if (type === 'Virtual Cycling' || type === 'VirtualRide') {
      return [DataDuration.type, DataPowerAvg.type];
    }
    const activityTypeEnum = ActivityTypes[type as keyof typeof ActivityTypes] || (Object.values(ActivityTypes).includes(type as ActivityTypes) ? type as ActivityTypes : ActivityTypes.Other);
    const group = ActivityTypesHelper.getActivityGroupForActivityType(activityTypeEnum);

    switch (group) {
      case ActivityTypeGroups.IndoorSports:
        return [DataDuration.type, DataEnergy.type];
      case ActivityTypeGroups.Running:
      case ActivityTypeGroups.TrailRunning:
      case ActivityTypeGroups.Cycling:
      case ActivityTypeGroups.Swimming:
      case ActivityTypeGroups.OutdoorAdventures:
      case ActivityTypeGroups.WinterSports:
      case ActivityTypeGroups.WaterSports:
      case ActivityTypeGroups.Performance:
      default:
        return [DataDistance.type, DataDuration.type];
    }
  }

  getStatValue(statType: string): string {
    const stat = this.event?.getStat(statType);
    return stat ? String(stat.getDisplayValue()) : '--';
  }

  getStatUnit(statType: string): string {
    const stat = this.event?.getStat(statType);
    return stat ? stat.getDisplayUnit() : '';
  }

  get feeling(): Feelings | null {
    const stat = this.event?.getStat(DataFeeling.type) as DataFeeling;
    return stat ? stat.getValue() as Feelings : null;
  }

  get feelingLabel(): string {
    const f = this.feeling;
    if (f === null) return '';
    return Feelings[f] || '';
  }

  get rpe(): RPEBorgCR10SCale | null {
    const stat = this.event?.getStat(DataRPE.type) as DataRPE;
    return stat ? stat.getValue() as RPEBorgCR10SCale : null;
  }

  get rpeLabel(): string {
    const r = this.rpe;
    if (r === null) return '';
    return RPEBorgCR10SCale[r] || '';
  }

  get feelingEmoji(): string {
    const f = this.feeling;
    if (f === null) return '';
    const emojiMap: { [key: number]: string } = {
      [Feelings.Excellent]: '🤩',
      [Feelings['Very Good']]: '😊',
      [Feelings.Good]: '😌',
      [Feelings.Average]: '😐',
      [Feelings.Poor]: '😕',
    };
    return emojiMap[f] || '';
  }




}
