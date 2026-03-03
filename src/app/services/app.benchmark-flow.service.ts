import { Injectable } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivityInterface, User } from '@sports-alliance/sports-lib';
import { AppEventInterface, BenchmarkOptions, BenchmarkResult, getBenchmarkPairKey } from '../../../functions/src/shared/app-event.interface';
import { AppBenchmarkService } from './app.benchmark.service';
import { AppEventService } from './app.event.service';
import { LoggerService } from './logger.service';
import { AppAnalyticsService } from './app.analytics.service';
import { BenchmarkBottomSheetComponent } from '../components/benchmark/benchmark-bottom-sheet.component';
import { BenchmarkSelectionDialogComponent } from '../components/benchmark/benchmark-selection-dialog.component';
import { firstValueFrom } from 'rxjs';
import { AppUserUtilities } from '../utils/app.user.utilities';

interface BenchmarkFlowConfig {
  event: AppEventInterface;
  persistEvent?: AppEventInterface;
  user?: User;
  result?: BenchmarkResult;
  initialSelection?: ActivityInterface[];
  onResult?: (result: BenchmarkResult) => void;
}

@Injectable({
  providedIn: 'root'
})
export class AppBenchmarkFlowService {
  constructor(
    private bottomSheet: MatBottomSheet,
    private overlay: Overlay,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private benchmarkService: AppBenchmarkService,
    private eventService: AppEventService,
    private logger: LoggerService,
    private analyticsService: AppAnalyticsService
  ) { }

  openBenchmarkReport(config: BenchmarkFlowConfig): void {
    if (!config.result) return;

    const sheetRef = this.bottomSheet.open(BenchmarkBottomSheetComponent, {
      data: {
        result: config.result,
        event: config.event,
        unitSettings: config.user?.settings?.unitSettings ?? AppUserUtilities.getDefaultUserUnitSettings(),
        summariesSettings: config.user?.settings?.summariesSettings,
        brandText: (config.user as any)?.brandText ?? null,
      },
      autoFocus: 'dialog',
      scrollStrategy: this.overlay.scrollStrategies.noop()
    });

    sheetRef.afterDismissed().subscribe((res: { rerun?: boolean } | undefined) => {
      if (res?.rerun) {
        this.openBenchmarkSelectionDialog(config);
      }
    });
  }

  async openBenchmarkSelectionDialog(config: BenchmarkFlowConfig): Promise<void> {
    const seededActivities = config.event.getActivities?.() || [];
    const initialSelection = (config.initialSelection && config.initialSelection.length)
      ? config.initialSelection
      : seededActivities.slice(0, 2);

    (document.activeElement as HTMLElement)?.blur();

    const dialogRef = this.dialog.open(BenchmarkSelectionDialogComponent, {
      width: '600px',
      data: {
        activities: seededActivities,
        initialSelection,
        isLoading: seededActivities.length === 0
      }
    });

    let resolvedEvent: AppEventInterface = config.event;
    let closed = false;

    dialogRef.afterClosed().subscribe(() => {
      closed = true;
    });

    dialogRef.afterClosed().subscribe(async (result: { activities: ActivityInterface[]; options: BenchmarkOptions } | undefined) => {
      if (result && result.activities?.length === 2) {
        await this.generateAndOpenReport({
          ...config,
          event: resolvedEvent,
          persistEvent: config.persistEvent ?? config.event,
          ref: result.activities[0],
          test: result.activities[1],
          options: result.options
        });
        return;
      }
    });

    if (seededActivities.length === 0) {
      void this.resolveEventWithActivities(config)
        .then((activeEvent) => {
          resolvedEvent = activeEvent;
          if (closed) return;
          const activities = activeEvent.getActivities?.() || [];
          const nextSelection = (config.initialSelection && config.initialSelection.length)
            ? config.initialSelection
            : activities.slice(0, 2);
          dialogRef.componentInstance?.setActivities(activities, nextSelection);
        })
        .catch((error) => {
          this.logger.error('[AppBenchmarkFlowService] Failed to resolve event activities for benchmark dialog', error);
          if (closed) {
            return;
          }
          dialogRef.componentInstance?.setActivities([], []);
          this.snackBar.open('Could not load activities for benchmarking', undefined, { duration: 3000 });
        });
    }
  }

  async generateAndOpenReport(config: BenchmarkFlowConfig & {
    ref: ActivityInterface;
    test: ActivityInterface;
    options: BenchmarkOptions;
  }): Promise<void> {
    this.snackBar.open('Generating Benchmark...', undefined, { duration: 2000 });

    try {
      this.analyticsService.logEvent('benchmark_generate_start');
      const benchmarkResult = await this.benchmarkService.generateBenchmark(config.ref, config.test, config.options);
      const key = getBenchmarkPairKey(config.ref.getID()!, config.test.getID()!);

      const persistEvent = config.persistEvent ?? config.event;
      if (!persistEvent.benchmarkResults) persistEvent.benchmarkResults = {};
      persistEvent.benchmarkResults[key] = benchmarkResult;

      if (persistEvent !== config.event) {
        if (!config.event.benchmarkResults) config.event.benchmarkResults = {};
        config.event.benchmarkResults[key] = benchmarkResult;
      }

      const benchmarkDevices = this.buildBenchmarkDevices(persistEvent);
      const benchmarkLatestAt = benchmarkResult.timestamp;
      persistEvent.hasBenchmark = true;
      persistEvent.benchmarkDevices = benchmarkDevices;
      persistEvent.benchmarkLatestAt = benchmarkLatestAt;
      if (persistEvent !== config.event) {
        config.event.hasBenchmark = true;
        config.event.benchmarkDevices = benchmarkDevices;
        config.event.benchmarkLatestAt = benchmarkLatestAt;
      }

      if (config.user && persistEvent.getID()) {
        await this.eventService.updateEventProperties(config.user, persistEvent.getID()!, {
          benchmarkResults: persistEvent.benchmarkResults,
          hasBenchmark: true,
          benchmarkDevices,
          benchmarkLatestAt
        });
      }

      this.analyticsService.logEvent('benchmark_generate_success');
      config.onResult?.(benchmarkResult);
      this.openBenchmarkReport({ ...config, result: benchmarkResult });
      this.snackBar.open('Benchmark Generated & Saved!', undefined, { duration: 2000 });
    } catch (error) {
      this.analyticsService.logEvent('benchmark_generate_failure');
      this.snackBar.open('Benchmark failed: ' + error, 'Close');
      this.logger.error('Benchmark flow failed', error);
    }
  }

  private async resolveEventWithActivities(config: BenchmarkFlowConfig): Promise<AppEventInterface> {
    const activities = config.event.getActivities?.() || [];
    if (activities.length > 0) {
      return config.event;
    }

    if (!config.user || !config.event.getID?.()) {
      return config.event;
    }

    try {
      const fullEvent = await firstValueFrom(this.eventService.getEventActivitiesAndAllStreams(config.user, config.event.getID()!));
      return fullEvent || config.event;
    } catch (error) {
      this.logger.error('Failed to load activities for benchmark selection', error);
      return config.event;
    }
  }

  private buildBenchmarkDevices(event: AppEventInterface): string[] {
    const devices = new Set<string>();
    if (event.benchmarkResults) {
      Object.values(event.benchmarkResults).forEach(result => {
        const names = [result.referenceName, result.testName];
        names.forEach(name => {
          const normalized = this.normalizeBenchmarkDevice(name);
          if (normalized) devices.add(normalized);
        });
      });
    }
    return Array.from(devices);
  }

  private normalizeBenchmarkDevice(name?: string): string | null {
    if (!name) return null;
    return name.trim().replace(/\s+/g, ' ').toLowerCase();
  }
}
