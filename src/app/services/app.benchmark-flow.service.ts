import { Injectable } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivityInterface, User } from '@sports-alliance/sports-lib';
import { AppEventInterface, BenchmarkOptions, BenchmarkResult, getBenchmarkPairKey } from '@shared/app-event.interface';
import { BENCHMARK_NO_OVERLAP_MESSAGE, BenchmarkNoOverlapError, AppBenchmarkService } from './app.benchmark.service';
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
  onEventTagsSaved?: (tags: string[]) => void;
  reviewTagSuggestions?: string[];
  onGenerationStart?: () => void;
  onGenerationComplete?: (status: 'success' | 'failure') => void;
  hydrateStreamsForGeneration?: boolean;
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

  private resolveInitialBenchmarkSelection(
    initialSelection: ActivityInterface[] | undefined,
    fallbackActivities: ActivityInterface[],
  ): ActivityInterface[] {
    if (initialSelection?.length === 2) {
      return initialSelection;
    }
    return fallbackActivities.slice(0, 2);
  }

  async openBenchmarkReport(config: BenchmarkFlowConfig): Promise<void> {
    if (!config.result) return;
    const activeEvent = await this.resolveEventWithActivitiesOnly(config);
    const nextConfig: BenchmarkFlowConfig = {
      ...config,
      event: activeEvent,
      persistEvent: config.persistEvent ?? config.event
    };

    const sheetRef = this.bottomSheet.open(BenchmarkBottomSheetComponent, {
      data: {
        result: nextConfig.result,
        event: nextConfig.event,
        persistEvent: nextConfig.persistEvent,
        user: nextConfig.user,
        onEventTagsSaved: nextConfig.onEventTagsSaved,
        reviewTagSuggestions: nextConfig.reviewTagSuggestions,
        unitSettings: nextConfig.user?.settings?.unitSettings ?? AppUserUtilities.getDefaultUserUnitSettings(),
        summariesSettings: nextConfig.user?.settings?.summariesSettings,
        brandText: (nextConfig.user as any)?.brandText ?? null,
      },
      autoFocus: 'dialog',
      scrollStrategy: this.overlay.scrollStrategies.noop()
    });

    sheetRef.afterDismissed().subscribe((res: { rerun?: boolean } | undefined) => {
      if (res?.rerun) {
        void this.openBenchmarkSelectionDialog(nextConfig);
      }
    });
  }

  async openBenchmarkSelectionDialog(config: BenchmarkFlowConfig): Promise<void> {
    const seededActivities = config.event.getActivities?.() || [];
    const initialSelection = this.resolveInitialBenchmarkSelection(config.initialSelection, seededActivities);

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
    const afterClosed$ = dialogRef.afterClosed();
    afterClosed$.subscribe(() => {
      closed = true;
    });
    const dialogClosed = firstValueFrom(afterClosed$).then(async (result: { activities: ActivityInterface[]; options: BenchmarkOptions } | undefined) => {
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
          const nextSelection = this.resolveInitialBenchmarkSelection(config.initialSelection, activities);
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

    await dialogClosed;
  }

  async openBenchmarkEntry(config: BenchmarkFlowConfig): Promise<void> {
    const activeEvent = await this.resolveEventWithActivities(config);
    const nextConfig: BenchmarkFlowConfig = {
      ...config,
      event: activeEvent,
      persistEvent: config.persistEvent ?? config.event,
    };
    const activities = activeEvent.getActivities?.() || [];

    if (activities.length === 2) {
      const referenceID = activities[0].getID();
      const testID = activities[1].getID();
      if (referenceID && testID) {
        const key = getBenchmarkPairKey(referenceID, testID);
        const savedResult = activeEvent.benchmarkResults?.[key] || nextConfig.persistEvent?.benchmarkResults?.[key];
        if (savedResult) {
          nextConfig.onResult?.(savedResult);
          await this.openBenchmarkReport({ ...nextConfig, result: savedResult });
          return;
        }

        await this.generateAndOpenReport({
          ...nextConfig,
          ref: activities[0],
          test: activities[1],
          options: { autoAlignTime: true },
        });
        return;
      }
    }

    await this.openBenchmarkSelectionDialog(nextConfig);
  }

  async generateAndOpenReport(config: BenchmarkFlowConfig & {
    ref: ActivityInterface;
    test: ActivityInterface;
    options: BenchmarkOptions;
  }): Promise<void> {
    this.snackBar.open('Generating Benchmark...', undefined, { duration: 2000 });
    config.onGenerationStart?.();
    let generationSucceeded = false;

    try {
      const generationConfig = await this.resolveBenchmarkGenerationConfig(config);
      this.analyticsService.logEvent('benchmark_generate_start');
      const benchmarkResult = await this.benchmarkService.generateBenchmark(
        generationConfig.ref,
        generationConfig.test,
        generationConfig.options
      );
      const referenceID = generationConfig.ref.getID();
      const testID = generationConfig.test.getID();
      if (!referenceID || !testID) {
        throw new Error('Benchmark activities are missing IDs');
      }
      const key = getBenchmarkPairKey(referenceID, testID);

      const persistEvent = generationConfig.persistEvent ?? generationConfig.event;
      if (!persistEvent.benchmarkResults) persistEvent.benchmarkResults = {};
      persistEvent.benchmarkResults[key] = benchmarkResult;

      if (persistEvent !== generationConfig.event) {
        if (!generationConfig.event.benchmarkResults) generationConfig.event.benchmarkResults = {};
        generationConfig.event.benchmarkResults[key] = benchmarkResult;
      }

      const benchmarkDevices = this.buildBenchmarkDevices(persistEvent);
      const benchmarkLatestAt = benchmarkResult.timestamp;
      persistEvent.hasBenchmark = true;
      persistEvent.benchmarkDevices = benchmarkDevices;
      persistEvent.benchmarkLatestAt = benchmarkLatestAt;
      if (persistEvent !== generationConfig.event) {
        generationConfig.event.hasBenchmark = true;
        generationConfig.event.benchmarkDevices = benchmarkDevices;
        generationConfig.event.benchmarkLatestAt = benchmarkLatestAt;
      }

      const persistEventID = persistEvent.getID();
      if (generationConfig.user && persistEventID) {
        await this.eventService.updateEventProperties(generationConfig.user, persistEventID, {
          benchmarkResults: persistEvent.benchmarkResults,
          hasBenchmark: true,
          benchmarkDevices,
          benchmarkLatestAt
        });
      }

      this.analyticsService.logEvent('benchmark_generate_success');
      generationConfig.onResult?.(benchmarkResult);
      await this.openBenchmarkReport({ ...generationConfig, result: benchmarkResult });
      this.snackBar.open('Benchmark Generated & Saved!', undefined, { duration: 2000 });
      generationSucceeded = true;
    } catch (error) {
      this.analyticsService.logEvent('benchmark_generate_failure');
      if (error instanceof BenchmarkNoOverlapError) {
        this.snackBar.open(BENCHMARK_NO_OVERLAP_MESSAGE, 'Close');
        this.logger.info('Benchmark skipped because activities do not overlap in time.', error);
        return;
      }

      this.snackBar.open('Benchmark failed: ' + error, 'Close');
      this.logger.error('Benchmark flow failed', error);
    } finally {
      config.onGenerationComplete?.(generationSucceeded ? 'success' : 'failure');
    }
  }

  private async resolveBenchmarkGenerationConfig(config: BenchmarkFlowConfig & {
    ref: ActivityInterface;
    test: ActivityInterface;
    options: BenchmarkOptions;
  }): Promise<BenchmarkFlowConfig & {
    ref: ActivityInterface;
    test: ActivityInterface;
    options: BenchmarkOptions;
  }> {
    if (!config.hydrateStreamsForGeneration) {
      return config;
    }

    const eventID = config.event.getID?.();
    const referenceID = config.ref.getID();
    const testID = config.test.getID();
    if (!config.user || !eventID || !referenceID || !testID) {
      return config;
    }

    try {
      const fullEvent = await firstValueFrom(this.eventService.getEventActivitiesAndAllStreams(config.user, eventID));
      const activities = fullEvent?.getActivities?.() || [];
      const hydratedReference = activities.find(activity => activity.getID() === referenceID);
      const hydratedTest = activities.find(activity => activity.getID() === testID);

      if (!fullEvent || !hydratedReference || !hydratedTest) {
        return config;
      }

      return {
        ...config,
        event: fullEvent,
        persistEvent: config.persistEvent ?? config.event,
        ref: hydratedReference,
        test: hydratedTest,
      };
    } catch (error) {
      this.logger.error('Failed to load all streams for benchmark generation', error);
      return config;
    }
  }

  private async resolveEventWithActivities(config: BenchmarkFlowConfig): Promise<AppEventInterface> {
    const activities = config.event.getActivities?.() || [];
    if (activities.length > 0) {
      return config.event;
    }

    const eventID = config.event.getID?.();
    if (!config.user || !eventID) {
      return config.event;
    }

    try {
      const fullEvent = await firstValueFrom(this.eventService.getEventActivitiesAndAllStreams(config.user, eventID));
      return fullEvent || config.event;
    } catch (error) {
      this.logger.error('Failed to load activities for benchmark selection', error);
      return config.event;
    }
  }

  private async resolveEventWithActivitiesOnly(config: BenchmarkFlowConfig): Promise<AppEventInterface> {
    const activities = config.event.getActivities?.() || [];
    if (activities.length > 0) {
      return config.event;
    }

    const eventID = config.event.getID?.();
    if (!config.user || !eventID) {
      return config.event;
    }

    try {
      const eventWithActivities = await firstValueFrom(this.eventService.getEventAndActivities(config.user, eventID));
      return eventWithActivities || config.event;
    } catch (error) {
      this.logger.error('Failed to load activities for benchmark report', error);
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
