import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { Overlay } from '@angular/cdk/overlay';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivityInterface, User } from '@sports-alliance/sports-lib';
import { AppEventInterface, BenchmarkOptions, BenchmarkResult, BenchmarkSourceChangedError, getBenchmarkPairKey } from '@shared/app-event.interface';
import { AppBenchmarkFlowService } from './app.benchmark-flow.service';
import { AppBenchmarkService, BenchmarkNoOverlapError, BenchmarkNoSharedDataError } from './app.benchmark.service';
import { AppEventService } from './app.event.service';
import { LoggerService } from './logger.service';
import { AppAnalyticsService } from './app.analytics.service';
import { AppHapticsService } from './app.haptics.service';

describe('AppBenchmarkFlowService', () => {
  let service: AppBenchmarkFlowService;
  let bottomSheet: { open: ReturnType<typeof vi.fn> };
  let overlay: { scrollStrategies: { noop: ReturnType<typeof vi.fn> } };
  let dialog: { open: ReturnType<typeof vi.fn> };
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let benchmarkService: { generateBenchmark: ReturnType<typeof vi.fn> };
  let eventService: {
    saveBenchmarkResult: ReturnType<typeof vi.fn>;
    getEventAndActivities: ReturnType<typeof vi.fn>;
    getEventActivitiesAndAllStreams: ReturnType<typeof vi.fn>;
  };
  let logger: { error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
  const haptics = { selection: vi.fn() };
  let analyticsService: { logEvent: ReturnType<typeof vi.fn> };

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
    overlay = { scrollStrategies: { noop: vi.fn().mockReturnValue({}) } };
    dialog = { open: vi.fn().mockReturnValue({ afterClosed: () => of(undefined), componentInstance: { setActivities: vi.fn() } }) };
    snackBar = { open: vi.fn() };
    benchmarkService = { generateBenchmark: vi.fn() };
    eventService = {
      saveBenchmarkResult: vi.fn().mockImplementation(async (_user, _id, result: BenchmarkResult) => ({
        benchmarkResults: { [getBenchmarkPairKey(result.referenceId, result.testId)]: result },
        hasBenchmark: true, benchmarkDevices: [], benchmarkLatestAt: result.timestamp,
      })),
      getEventAndActivities: vi.fn(),
      getEventActivitiesAndAllStreams: vi.fn(),
    };
    logger = { error: vi.fn(), info: vi.fn() };
    analyticsService = { logEvent: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        AppBenchmarkFlowService,
        { provide: AppHapticsService, useValue: haptics },
        { provide: MatBottomSheet, useValue: bottomSheet },
        { provide: Overlay, useValue: overlay },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AppBenchmarkService, useValue: benchmarkService },
        { provide: AppEventService, useValue: eventService },
        { provide: LoggerService, useValue: logger },
        { provide: AppAnalyticsService, useValue: analyticsService },
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

    await service.openBenchmarkReport({ event, result });

    expect(bottomSheet.open).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(dialog.open).toHaveBeenCalledTimes(1));
    expect(analyticsService.logEvent).not.toHaveBeenCalled();
  });

  it('opens read-only reports without allowing rerun generation', async () => {
    const event = createEvent();
    const result = createResult();

    bottomSheet.open.mockReturnValueOnce({ afterDismissed: () => of({ rerun: true }) });

    await service.openBenchmarkReport({ event, result, allowRerun: false });

    expect(bottomSheet.open).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: expect.objectContaining({
          allowRerun: false,
        }),
      }),
    );
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('reports a lazy selection failure when rerunning from an open report', async () => {
    const event = createEvent();
    const result = createResult();
    const loadError = new Error('selection chunk unavailable');
    bottomSheet.open.mockReturnValueOnce({ afterDismissed: () => of({ rerun: true }) });
    vi.spyOn(service, 'openBenchmarkSelectionDialog').mockRejectedValueOnce(loadError);

    await service.openBenchmarkReport({ event, result });

    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        '[AppBenchmarkFlowService] Failed to reopen benchmark selection',
        loadError,
      );
    });
    expect(snackBar.open).toHaveBeenCalledWith(
      'Could not open benchmark selection',
      undefined,
      { duration: 3000 },
    );
  });

  it('passes user brandText to benchmark bottom sheet data', async () => {
    const event = createEvent();
    const result = createResult();
    const user = { uid: 'user-1', brandText: 'My Brand' } as User;

    await service.openBenchmarkReport({ event, result, user });

    const openCallArgs = bottomSheet.open.mock.calls[0];
    expect(openCallArgs).toBeTruthy();
    expect(openCallArgs[1]?.data?.brandText).toBe('My Brand');
  });

  it('loads only event activities before opening report when benchmark is launched from a summary event', async () => {
    const summaryEvent = {
      benchmarkResults: {},
      getActivities: () => [],
      getID: () => 'event-2',
    } as unknown as AppEventInterface;
    const fullEvent = createEvent();
    const result = createResult();
    const user = { uid: 'user-1' } as User;

    eventService.getEventAndActivities.mockReturnValueOnce(of(fullEvent));

    await service.openBenchmarkReport({ event: summaryEvent, persistEvent: summaryEvent, result, user });

    expect(eventService.getEventAndActivities).toHaveBeenCalledWith(user, summaryEvent.getID());
    expect(eventService.getEventActivitiesAndAllStreams).not.toHaveBeenCalled();
    expect(bottomSheet.open).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: expect.objectContaining({
          event: fullEvent,
          result
        })
      })
    );
  });

  it('opens selection dialog and runs benchmark when two activities returned', async () => {
    const event = createEvent();
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
    expect(analyticsService.logEvent).not.toHaveBeenCalled();
  });

  it('keeps selection dialog promise pending until dialog close and generation complete', async () => {
    const event = createEvent();
    const options: BenchmarkOptions = { autoAlignTime: true };
    const afterClosed = new Subject<{ activities: ActivityInterface[]; options: BenchmarkOptions } | undefined>();
    let resolveGeneration: (() => void) | undefined;
    const generationPromise = new Promise<void>((resolve) => {
      resolveGeneration = resolve;
    });
    let resolved = false;

    vi.spyOn(service, 'generateAndOpenReport').mockReturnValueOnce(generationPromise);
    dialog.open.mockReturnValueOnce({
      afterClosed: () => afterClosed.asObservable(),
      componentInstance: { setActivities: vi.fn() },
    });

    const openPromise = service.openBenchmarkSelectionDialog({ event }).then(() => {
      resolved = true;
    });

    await vi.waitFor(() => expect(dialog.open).toHaveBeenCalledTimes(1));
    expect(resolved).toBe(false);

    afterClosed.next({ activities: [activityA, activityB], options });
    afterClosed.complete();

    await vi.waitFor(() => {
      expect(service.generateAndOpenReport).toHaveBeenCalledWith(expect.objectContaining({
        event,
        ref: activityA,
        test: activityB,
        options,
      }));
    });
    expect(resolved).toBe(false);

    resolveGeneration?.();
    await openPromise;

    expect(resolved).toBe(true);
  });

  it('uses an exact two-activity initial selection for the selection dialog', async () => {
    const event = createEvent();

    await service.openBenchmarkSelectionDialog({
      event,
      initialSelection: [activityB, activityA],
    });

    expect(dialog.open).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: expect.objectContaining({
          initialSelection: [activityB, activityA],
        }),
      }),
    );
  });

  it('falls back to the first two event activities when initial selection has more than two activities', async () => {
    const activityC = { getID: () => 'c1' } as ActivityInterface;
    const event = {
      benchmarkResults: {},
      getActivities: () => [activityA, activityB, activityC],
      getID: () => 'event-1',
    } as unknown as AppEventInterface;

    await service.openBenchmarkSelectionDialog({
      event,
      initialSelection: [activityA, activityB, activityC],
    });

    expect(dialog.open).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: expect.objectContaining({
          initialSelection: [activityA, activityB],
        }),
      }),
    );
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
    expect(analyticsService.logEvent).not.toHaveBeenCalled();
  });

  it('opens a saved benchmark report for an exact two-activity pair', async () => {
    const event = createEvent();
    const result = createResult();
    const key = getBenchmarkPairKey(activityA.getID(), activityB.getID());
    event.benchmarkResults = { [key]: result };
    const onResult = vi.fn();
    const openReportSpy = vi.spyOn(service, 'openBenchmarkReport').mockResolvedValueOnce(undefined);
    const generateSpy = vi.spyOn(service, 'generateAndOpenReport').mockResolvedValueOnce(undefined);

    await service.openBenchmarkEntry({ event, onResult });

    expect(onResult).toHaveBeenCalledWith(result);
    expect(openReportSpy).toHaveBeenCalledWith(expect.objectContaining({ event, result }));
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('auto-generates a benchmark for an exact two-activity pair without a saved result', async () => {
    const event = createEvent();
    const generateSpy = vi.spyOn(service, 'generateAndOpenReport').mockResolvedValueOnce(undefined);
    const selectionSpy = vi.spyOn(service, 'openBenchmarkSelectionDialog').mockResolvedValueOnce(undefined);

    await service.openBenchmarkEntry({ event });

    expect(generateSpy).toHaveBeenCalledWith(expect.objectContaining({
      event,
      ref: activityA,
      test: activityB,
      options: { autoAlignTime: true },
    }));
    expect(selectionSpy).not.toHaveBeenCalled();
  });

  it('hydrates all streams before generation when requested by an auto-open flow', async () => {
    const originalEvent = createEvent();
    const user = { uid: 'user-1' } as User;
    const hydratedActivityA = { getID: () => 'a1' } as ActivityInterface;
    const hydratedActivityB = { getID: () => 'b1' } as ActivityInterface;
    const hydratedEvent = {
      benchmarkResults: {},
      getActivities: () => [hydratedActivityA, hydratedActivityB],
      getID: () => 'event-1',
    } as unknown as AppEventInterface;
    const result = createResult();

    eventService.getEventActivitiesAndAllStreams.mockReturnValueOnce(of(hydratedEvent));
    benchmarkService.generateBenchmark.mockResolvedValueOnce(result);

    await service.generateAndOpenReport({
      event: originalEvent,
      user,
      ref: activityA,
      test: activityB,
      options: { autoAlignTime: true },
      hydrateStreamsForGeneration: true,
    });

    expect(eventService.getEventActivitiesAndAllStreams).toHaveBeenCalledWith(user, 'event-1');
    expect(benchmarkService.generateBenchmark).toHaveBeenCalledWith(
      hydratedActivityA,
      hydratedActivityB,
      { autoAlignTime: true },
    );
    expect(originalEvent.benchmarkResults?.[getBenchmarkPairKey('a1', 'b1')]).toBe(result);
    expect(hydratedEvent.benchmarkResults?.[getBenchmarkPairKey('a1', 'b1')]).toBe(result);
    expect(bottomSheet.open).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: expect.objectContaining({
          event: hydratedEvent,
          result,
        }),
      }),
    );
  });

  it.each(['failed download', 'changed IDs', 'missing event'])('keeps saved reports untouched after %s and reloads on Retry', async (failure) => {
    const event = createEvent();
    const oldResult = createResult();
    event.benchmarkResults = { a1_b1: oldResult };
    eventService.getEventActivitiesAndAllStreams.mockReturnValue(failure === 'failed download'
      ? throwError(() => new Error('download unavailable'))
      : of(failure === 'missing event' ? null : { getActivities: () => [{ getID: () => 'new-a' }, { getID: () => 'new-b' }] }));
    const actions$ = new Subject<void>();
    snackBar.open.mockReturnValue({ onAction: () => actions$ });
    const freshEvent = createEvent();
    eventService.getEventAndActivities.mockReturnValue(of(freshEvent));
    const selection = vi.spyOn(service, 'openBenchmarkSelectionDialog').mockResolvedValue(undefined);
    const complete = vi.fn();
    await service.generateAndOpenReport({ event, user: { uid: 'user-1' } as User, ref: activityA, test: activityB,
      options: { autoAlignTime: true }, hydrateStreamsForGeneration: true, onGenerationComplete: complete });
    expect(benchmarkService.generateBenchmark).not.toHaveBeenCalled();
    expect(eventService.saveBenchmarkResult).not.toHaveBeenCalled();
    expect(event.benchmarkResults).toEqual({ a1_b1: oldResult });
    expect(complete).toHaveBeenCalledWith('failure', 'streams_unavailable');
    expect(snackBar.open).toHaveBeenCalledWith(expect.stringContaining('Could not load'), 'Retry');
    expect(haptics.selection).not.toHaveBeenCalled();
    actions$.next();
    await vi.waitFor(() => expect(selection).toHaveBeenCalledWith(expect.objectContaining({
      event: freshEvent, persistEvent: freshEvent, initialSelection: undefined,
    })));
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    actions$.next();
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  it('rejects missing shared measurements without saving or opening a report', async () => {
    benchmarkService.generateBenchmark.mockRejectedValue(new BenchmarkNoSharedDataError());
    await service.generateAndOpenReport({ event: createEvent(), ref: activityA, test: activityB, options: { autoAlignTime: false } });
    expect(eventService.saveBenchmarkResult).not.toHaveBeenCalled();
    expect(bottomSheet.open).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(expect.stringContaining('No usable shared measurements'), 'Close');
  });

  it('reloads before retry when reparse overtakes report generation', async () => {
    const event = createEvent();
    event.benchmarkSourceRevision = 4;
    eventService.getEventActivitiesAndAllStreams.mockReturnValue(of(event));
    eventService.saveBenchmarkResult.mockRejectedValue(new BenchmarkSourceChangedError());
    const result = createResult();
    benchmarkService.generateBenchmark.mockImplementation(async () => {
      event.benchmarkSourceRevision = 5;
      return result;
    });
    const complete = vi.fn();
    await service.generateAndOpenReport({ event, user: { uid: 'u1' } as User, ref: activityA, test: activityB,
      options: { autoAlignTime: true }, hydrateStreamsForGeneration: true, onGenerationComplete: complete });
    expect(eventService.saveBenchmarkResult).toHaveBeenCalledWith(expect.anything(), 'event-1', result, 4);
    expect(event.benchmarkResults).toEqual({});
    expect(bottomSheet.open).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(expect.stringContaining('recordings changed'), 'Retry');
    expect(complete).toHaveBeenCalledWith('failure', 'streams_unavailable');
  });

  it('keeps the old in-memory report when saving a replacement fails', async () => {
    const event = createEvent();
    const oldResult = createResult();
    event.benchmarkResults = { a1_b1: oldResult };
    benchmarkService.generateBenchmark.mockResolvedValue({ ...createResult(), timestamp: new Date(0) });
    eventService.saveBenchmarkResult.mockRejectedValue(new Error('write unavailable'));
    await service.generateAndOpenReport({ event, user: { uid: 'user-1' } as User, ref: activityA, test: activityB, options: { autoAlignTime: false } });
    expect(event.benchmarkResults.a1_b1).toBe(oldResult);
    expect(bottomSheet.open).not.toHaveBeenCalled();
  });

  it('opens selection when a benchmark event has more than two activities', async () => {
    const activityC = { getID: () => 'c1' } as ActivityInterface;
    const event = {
      benchmarkResults: {},
      getActivities: () => [activityA, activityB, activityC],
      getID: () => 'event-1',
    } as unknown as AppEventInterface;
    const selectionSpy = vi.spyOn(service, 'openBenchmarkSelectionDialog').mockResolvedValueOnce(undefined);

    await service.openBenchmarkEntry({ event });

    expect(selectionSpy).toHaveBeenCalledWith(expect.objectContaining({ event }));
  });

  it('generates, persists, and reopens report', async () => {
    const event = createEvent();
    const user = { uid: 'user-1' } as User;
    const result = createResult();
    const options: BenchmarkOptions = { autoAlignTime: true };
    const onResult = vi.fn();
    const generationLifecycle: string[] = [];

    benchmarkService.generateBenchmark.mockResolvedValueOnce(result);

    await service.generateAndOpenReport({
      event,
      user,
      ref: activityA,
      test: activityB,
      options,
      onResult,
      onGenerationStart: () => generationLifecycle.push('start'),
      onGenerationComplete: (status) => generationLifecycle.push(`complete:${status}`),
    });

    const key = getBenchmarkPairKey(activityA.getID(), activityB.getID());
    expect(benchmarkService.generateBenchmark).toHaveBeenCalledWith(activityA, activityB, options);
    expect(event.benchmarkResults?.[key]).toBe(result);
    expect(eventService.saveBenchmarkResult).toHaveBeenCalledWith(user, 'event-1', result, 0);
    expect(onResult).toHaveBeenCalledWith(result);
    expect(bottomSheet.open).toHaveBeenCalled();
    expect(analyticsService.logEvent).toHaveBeenCalledWith('benchmark_generate_start');
    expect(analyticsService.logEvent).toHaveBeenCalledWith('benchmark_generate_success');
    expect(generationLifecycle).toEqual(['start', 'complete:success']);
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

    expect(eventService.saveBenchmarkResult).not.toHaveBeenCalled();
    expect(analyticsService.logEvent).toHaveBeenCalledWith('benchmark_generate_start');
    expect(analyticsService.logEvent).toHaveBeenCalledWith('benchmark_generate_success');
  });

  it('logs failure analytics when benchmark generation fails', async () => {
    const event = createEvent();
    const options: BenchmarkOptions = { autoAlignTime: true };
    const generationLifecycle: string[] = [];

    benchmarkService.generateBenchmark.mockRejectedValueOnce(new Error('boom'));

    await service.generateAndOpenReport({
      event,
      ref: activityA,
      test: activityB,
      options,
      onGenerationStart: () => generationLifecycle.push('start'),
      onGenerationComplete: (status, failureReason) => generationLifecycle.push(`complete:${status}:${failureReason ?? 'none'}`),
    });

    expect(analyticsService.logEvent).toHaveBeenCalledWith('benchmark_generate_start');
    expect(analyticsService.logEvent).toHaveBeenCalledWith('benchmark_generate_failure');
    expect(generationLifecycle).toEqual(['start', 'complete:failure:unknown']);
  });

  it('does not log no-overlap benchmark outcomes as errors', async () => {
    const event = createEvent();
    const options: BenchmarkOptions = { autoAlignTime: true };
    const generationLifecycle: string[] = [];

    benchmarkService.generateBenchmark.mockRejectedValueOnce(new BenchmarkNoOverlapError());

    await service.generateAndOpenReport({
      event,
      ref: activityA,
      test: activityB,
      options,
      onGenerationStart: () => generationLifecycle.push('start'),
      onGenerationComplete: (status, failureReason) => generationLifecycle.push(`complete:${status}:${failureReason ?? 'none'}`),
    });

    expect(snackBar.open).toHaveBeenLastCalledWith('Activities do not overlap in time.', 'Close');
    expect(logger.info).toHaveBeenCalledWith(
      'Benchmark skipped because activities do not overlap in time.',
      expect.any(BenchmarkNoOverlapError),
    );
    expect(logger.error).not.toHaveBeenCalledWith('Benchmark flow failed', expect.any(BenchmarkNoOverlapError));
    expect(analyticsService.logEvent).toHaveBeenCalledWith('benchmark_generate_failure');
    expect(generationLifecycle).toEqual(['start', 'complete:failure:no_overlap']);
  });
});
