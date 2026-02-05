import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { of } from 'rxjs';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivityInterface, User } from '@sports-alliance/sports-lib';
import { AppEventInterface, BenchmarkOptions, BenchmarkResult, getBenchmarkPairKey } from '../../../functions/src/shared/app-event.interface';
import { AppBenchmarkFlowService } from './app.benchmark-flow.service';
import { AppBenchmarkService } from './app.benchmark.service';
import { AppEventService } from './app.event.service';
import { LoggerService } from './logger.service';

describe('AppBenchmarkFlowService', () => {
  let service: AppBenchmarkFlowService;
  let bottomSheet: { open: ReturnType<typeof vi.fn> };
  let dialog: { open: ReturnType<typeof vi.fn> };
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let benchmarkService: { generateBenchmark: ReturnType<typeof vi.fn> };
  let eventService: {
    updateEventProperties: ReturnType<typeof vi.fn>;
    getEventActivitiesAndAllStreams: ReturnType<typeof vi.fn>;
  };
  let logger: { error: ReturnType<typeof vi.fn> };

  const activityA = { getID: () => 'a1' } as ActivityInterface;
  const activityB = { getID: () => 'b1' } as ActivityInterface;

  const createEvent = () => ({
    benchmarkResults: {},
    getActivities: () => [activityA, activityB],
    getID: () => 'event-1',
  }) as unknown as AppEventInterface;

  const createResult = (): BenchmarkResult => ({
    referenceId: 'a1',
    testId: 'b1',
    referenceName: 'Device A',
    testName: 'Device B',
    timestamp: new Date(),
    metrics: {
      gnss: { cep50: 0, cep95: 0, maxDeviation: 0, rmse: 0, totalDistanceDifference: 0 },
      streamMetrics: {}
    }
  });

  beforeEach(() => {
    bottomSheet = { open: vi.fn().mockReturnValue({ afterDismissed: () => of(undefined) }) };
    dialog = { open: vi.fn().mockReturnValue({ afterClosed: () => of(undefined), componentInstance: { setActivities: vi.fn() } }) };
    snackBar = { open: vi.fn() };
    benchmarkService = { generateBenchmark: vi.fn() };
    eventService = {
      updateEventProperties: vi.fn().mockResolvedValue(undefined),
      getEventActivitiesAndAllStreams: vi.fn(),
    };
    logger = { error: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        AppBenchmarkFlowService,
        { provide: MatBottomSheet, useValue: bottomSheet },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AppBenchmarkService, useValue: benchmarkService },
        { provide: AppEventService, useValue: eventService },
        { provide: LoggerService, useValue: logger },
      ]
    });

    service = TestBed.inject(AppBenchmarkFlowService);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the report and triggers selection dialog on rerun', async () => {
    const event = createEvent();
    const result = createResult();

    bottomSheet.open.mockReturnValueOnce({ afterDismissed: () => of({ rerun: true }) });
    dialog.open.mockReturnValueOnce({ afterClosed: () => of(undefined), componentInstance: { setActivities: vi.fn() } });

    service.openBenchmarkReport({ event, result });

    await Promise.resolve();

    expect(bottomSheet.open).toHaveBeenCalledTimes(1);
    expect(dialog.open).toHaveBeenCalledTimes(1);
  });

  it('opens selection dialog and runs benchmark when two activities returned', async () => {
    const event = createEvent();
    const result = createResult();
    const options: BenchmarkOptions = { autoAlignTime: true };

    const generateSpy = vi.spyOn(service, 'generateAndOpenReport').mockResolvedValue();
    dialog.open.mockReturnValueOnce({ afterClosed: () => of({ activities: [activityA, activityB], options }), componentInstance: { setActivities: vi.fn() } });

    await service.openBenchmarkSelectionDialog({ event });

    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(generateSpy).toHaveBeenCalledWith(expect.objectContaining({
      event,
      ref: activityA,
      test: activityB,
      options
    }));
  });

  it('loads activities when missing and user provided', async () => {
    const emptyEvent = {
      benchmarkResults: {},
      getActivities: () => [],
      getID: () => 'event-2',
    } as unknown as AppEventInterface;
    const user = { uid: 'user-1' } as User;
    const fullEvent = createEvent();

    eventService.getEventActivitiesAndAllStreams.mockReturnValueOnce(of(fullEvent));
    const setActivities = vi.fn();
    dialog.open.mockReturnValueOnce({ afterClosed: () => of(undefined), componentInstance: { setActivities } });

    await service.openBenchmarkSelectionDialog({ event: emptyEvent, user, persistEvent: emptyEvent });
    await Promise.resolve();

    expect(eventService.getEventActivitiesAndAllStreams).toHaveBeenCalledWith(user, emptyEvent.getID());
    expect(dialog.open).toHaveBeenCalledTimes(1);
  });

  it('generates, persists, and reopens report', async () => {
    const event = createEvent();
    const user = { uid: 'user-1' } as User;
    const result = createResult();
    const options: BenchmarkOptions = { autoAlignTime: true };
    const onResult = vi.fn();

    benchmarkService.generateBenchmark.mockResolvedValueOnce(result);

    await service.generateAndOpenReport({
      event,
      user,
      ref: activityA,
      test: activityB,
      options,
      onResult
    });

    const key = getBenchmarkPairKey(activityA.getID(), activityB.getID());
    expect(benchmarkService.generateBenchmark).toHaveBeenCalledWith(activityA, activityB, options);
    expect(event.benchmarkResults?.[key]).toBe(result);
    expect(eventService.updateEventProperties).toHaveBeenCalledWith(user, event.getID(), {
      benchmarkResults: event.benchmarkResults
    });
    expect(onResult).toHaveBeenCalledWith(result);
    expect(bottomSheet.open).toHaveBeenCalled();
  });

  it('skips persistence when no user is provided', async () => {
    const event = createEvent();
    const result = createResult();
    const options: BenchmarkOptions = { autoAlignTime: true };

    benchmarkService.generateBenchmark.mockResolvedValueOnce(result);

    await service.generateAndOpenReport({
      event,
      ref: activityA,
      test: activityB,
      options
    });

    expect(eventService.updateEventProperties).not.toHaveBeenCalled();
  });
});
