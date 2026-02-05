import { Injectable } from '@angular/core';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivityInterface, User } from '@sports-alliance/sports-lib';
import { AppEventInterface, BenchmarkOptions, BenchmarkResult, getBenchmarkPairKey } from '../../../functions/src/shared/app-event.interface';
import { AppBenchmarkService } from './app.benchmark.service';
import { AppEventService } from './app.event.service';
import { LoggerService } from './logger.service';
import { BenchmarkBottomSheetComponent } from '../components/benchmark/benchmark-bottom-sheet.component';
import { BenchmarkSelectionDialogComponent } from '../components/benchmark/benchmark-selection-dialog.component';
import { firstValueFrom } from 'rxjs';

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
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private benchmarkService: AppBenchmarkService,
    private eventService: AppEventService,
    private logger: LoggerService
  ) { }

  openBenchmarkReport(config: BenchmarkFlowConfig): void {
    if (!config.result) return;

    const sheetRef = this.bottomSheet.open(BenchmarkBottomSheetComponent, {
      data: {
        result: config.result,
        event: config.event
      },
      autoFocus: 'dialog'
    });

    sheetRef.afterDismissed().subscribe((res: { rerun?: boolean } | undefined) => {
      if (res?.rerun) {
        this.openBenchmarkSelectionDialog(config);
      }
    });
  }

  async openBenchmarkSelectionDialog(config: BenchmarkFlowConfig): Promise<void> {
    const activeEvent = await this.resolveEventWithActivities(config);
    const activities = activeEvent.getActivities() || [];
    const initialSelection = (config.initialSelection && config.initialSelection.length)
      ? config.initialSelection
      : activities.slice(0, 2);

    (document.activeElement as HTMLElement)?.blur();

    const dialogRef = this.dialog.open(BenchmarkSelectionDialogComponent, {
      width: '600px',
      data: {
        activities,
        initialSelection
      }
    });

    dialogRef.afterClosed().subscribe(async (result: { activities: ActivityInterface[]; options: BenchmarkOptions } | undefined) => {
      if (result && result.activities?.length === 2) {
        await this.generateAndOpenReport({
          ...config,
          event: activeEvent,
          persistEvent: config.persistEvent ?? config.event,
          ref: result.activities[0],
          test: result.activities[1],
          options: result.options
        });
      }
    });
  }

  async generateAndOpenReport(config: BenchmarkFlowConfig & {
    ref: ActivityInterface;
    test: ActivityInterface;
    options: BenchmarkOptions;
  }): Promise<void> {
    this.snackBar.open('Generating Benchmark...', undefined, { duration: 2000 });

    try {
      const benchmarkResult = await this.benchmarkService.generateBenchmark(config.ref, config.test, config.options);
      const key = getBenchmarkPairKey(config.ref.getID()!, config.test.getID()!);

      const persistEvent = config.persistEvent ?? config.event;
      if (!persistEvent.benchmarkResults) persistEvent.benchmarkResults = {};
      persistEvent.benchmarkResults[key] = benchmarkResult;

      if (persistEvent !== config.event) {
        if (!config.event.benchmarkResults) config.event.benchmarkResults = {};
        config.event.benchmarkResults[key] = benchmarkResult;
      }

      if (config.user && persistEvent.getID()) {
        await this.eventService.updateEventProperties(config.user, persistEvent.getID()!, {
          benchmarkResults: persistEvent.benchmarkResults
        });
      }

      config.onResult?.(benchmarkResult);
      this.openBenchmarkReport({ ...config, result: benchmarkResult });
      this.snackBar.open('Benchmark Generated & Saved!', undefined, { duration: 2000 });
    } catch (error) {
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
}
