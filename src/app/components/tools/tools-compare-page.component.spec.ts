import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes, DataActivityTypes, DataAltitude, DataAscent, DataDescent, DataDistance, DataHeartRate, User } from '@sports-alliance/sports-lib';
import { AppEventInterface, BenchmarkResult } from '@shared/app-event.interface';

import { AppAuthService } from '../../authentication/app.auth.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppBenchmarkFlowService } from '../../services/app.benchmark-flow.service';
import { AppEventService } from '../../services/app.event.service';
import { AppToolsComparisonService } from '../../services/app.tools-comparison.service';
import { LoggerService } from '../../services/logger.service';
import { ToolsComparePageComponent } from './tools-compare-page.component';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { AppColors } from '../../services/color/app.colors';
import { AppDeviceColorPreferenceService } from '../../services/color/app-device-color-preference.service';
import { normalizeDeviceColorKey } from '../../helpers/device-color-preferences.helper';
import { DeviceColorPreferencesDialogComponent } from './device-color-preferences-dialog.component';
import { AppHapticsService } from '../../services/app.haptics.service';
import { BenchmarkReviewService } from '../../services/benchmark-review.service';
import { BenchmarkReviewTagsDialogComponent } from '../benchmark/benchmark-review-tags-dialog.component';

function makeComparisonEvent(id: string, overrides: {
  title?: string;
  description?: string;
  startDate?: Date;
  sourceFilesCount?: number;
  originalFiles?: AppEventInterface['originalFiles'];
  benchmarkResults?: Record<string, unknown>;
  benchmarkDevices?: string[];
  benchmarkReviewTags?: string[];
  activities?: unknown[];
} = {}): AppEventInterface {
  return {
    getID: () => id,
    name: overrides.title || 'Benchmark comparison',
    description: overrides.description || '',
    startDate: overrides.startDate || new Date('2026-01-01T00:00:00.000Z'),
    sourceFilesCount: overrides.sourceFilesCount,
    originalFiles: overrides.originalFiles,
    benchmarkResults: overrides.benchmarkResults,
    benchmarkDevices: overrides.benchmarkDevices,
    benchmarkReviewTags: overrides.benchmarkReviewTags,
    getActivities: () => overrides.activities || [],
  } as unknown as AppEventInterface;
}

function makeStat(type: string, value: number, displayValue: string, displayUnit: string) {
  return {
    getType: () => type,
    getValue: () => value,
    getDisplayValue: () => displayValue,
    getDisplayUnit: () => displayUnit,
  };
}

function makeActivity(id: string, options: {
  deviceName: string;
  swInfo?: string;
  activityType: string;
  distance?: number;
  ascent?: number;
  descent?: number;
}) {
  const stats = new Map<string, ReturnType<typeof makeStat>>();
  if (typeof options.distance === 'number') {
    stats.set(DataDistance.type, makeStat(DataDistance.type, options.distance, `${(options.distance / 1000).toFixed(2)}`, 'km'));
  }
  if (typeof options.ascent === 'number') {
    stats.set(DataAscent.type, makeStat(DataAscent.type, options.ascent, `${Math.round(options.ascent)}`, 'm'));
  }
  if (typeof options.descent === 'number') {
    stats.set(DataDescent.type, makeStat(DataDescent.type, options.descent, `${Math.round(options.descent)}`, 'm'));
  }

  return {
    getID: () => id,
    creator: {
      name: options.deviceName,
      swInfo: options.swInfo,
    },
    type: options.activityType,
    getActivityTypesAsString: () => options.activityType,
    getActivityTypesAsArray: () => [options.activityType],
    getDistance: () => stats.get(DataDistance.type),
    getStat: (type: string) => stats.get(type),
    getStatsAsArray: () => Array.from(stats.values()),
  };
}

function makeBenchmarkResult(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  const defaultResult: BenchmarkResult = {
    referenceId: 'reference-activity',
    testId: 'test-activity',
    referenceName: 'Garmin Reference',
    testName: 'Suunto Test',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    metrics: {
      gnss: {
        cep50: 2,
        cep95: 4,
        maxDeviation: 8,
        rmse: 3,
        totalDistanceDifference: 12,
      },
      streamMetrics: {},
    },
  };

  return {
    ...defaultResult,
    ...overrides,
    metrics: overrides.metrics || defaultResult.metrics,
  };
}

describe('ToolsComparePageComponent', () => {
  let fixture: ComponentFixture<ToolsComparePageComponent>;
  let component: ToolsComparePageComponent;
  let userSubject: BehaviorSubject<User | null>;
  let routerNavigateSpy: ReturnType<typeof vi.spyOn>;
  let eventServiceMock: {
    deleteAllEventData: ReturnType<typeof vi.fn>;
    getActivitiesOnceByEventWithOptions: ReturnType<typeof vi.fn>;
    getActivitiesOnceByEventsWithOptions: ReturnType<typeof vi.fn>;
    updateEventProperties: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    user$: ReturnType<BehaviorSubject<User | null>['asObservable']>;
    redirectUrl: string | null;
  };
  let comparisonServiceMock: {
    validateFiles: ReturnType<typeof vi.fn>;
    createComparison: ReturnType<typeof vi.fn>;
    getBenchmarkComparisonCount: ReturnType<typeof vi.fn>;
    getBenchmarkComparisonPage: ReturnType<typeof vi.fn>;
  };
  let eventColorServiceMock: {
    getActivityColor: ReturnType<typeof vi.fn>;
    getAutomaticActivityColor: ReturnType<typeof vi.fn>;
    getColorForActivityTypeByActivityTypeGroup: ReturnType<typeof vi.fn>;
    getDifferenceColor: ReturnType<typeof vi.fn>;
  };
  let benchmarkFlowServiceMock: {
    openBenchmarkReport: ReturnType<typeof vi.fn>;
    openBenchmarkSelectionDialog: ReturnType<typeof vi.fn>;
  };
  let hapticsServiceMock: {
    selection: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let benchmarkReviewServiceMock: {
    normalizeTags: ReturnType<typeof vi.fn>;
    getEventTags: ReturnType<typeof vi.fn>;
    saveEventTags: ReturnType<typeof vi.fn>;
  };
  let deviceColorByNameState: Record<string, string>;
  let deviceColorPreferenceServiceMock: {
    deviceColorByName: ReturnType<typeof vi.fn>;
    normalizeDeviceColorKey: ReturnType<typeof vi.fn>;
  };
  let analyticsServiceMock: {
    logToolCompareCreate: ReturnType<typeof vi.fn>;
    logToolCompareFileSelection: ReturnType<typeof vi.fn>;
    logToolCompareSavedAction: ReturnType<typeof vi.fn>;
    logToolCompareSignIn: ReturnType<typeof vi.fn>;
  };
  let loggerMock: {
    warn: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    userSubject = new BehaviorSubject<User | null>(null);
    authServiceMock = {
      user$: userSubject.asObservable(),
      redirectUrl: null,
    };
    comparisonServiceMock = {
      validateFiles: vi.fn().mockReturnValue(null),
      createComparison: vi.fn().mockResolvedValue({
        eventId: 'event-1',
        mergeType: 'benchmark',
        sourceFilesCount: 2,
        activitiesCount: 2,
        uploadLimit: 100,
        uploadCountAfterWrite: 1,
      }),
      getBenchmarkComparisonCount: vi.fn().mockReturnValue(of(0)),
      getBenchmarkComparisonPage: vi.fn().mockReturnValue(of({
        events: [],
        nextCursor: null,
        hasMore: false,
      })),
    };
    eventServiceMock = {
      deleteAllEventData: vi.fn().mockResolvedValue(true),
      getActivitiesOnceByEventWithOptions: vi.fn().mockReturnValue(of([])),
      getActivitiesOnceByEventsWithOptions: vi.fn().mockReturnValue(of(new Map())),
      updateEventProperties: vi.fn().mockResolvedValue(undefined),
    };
    eventColorServiceMock = {
      getActivityColor: vi.fn((_activities, activity) => {
        const activityID = activity?.getID?.();
        if (activityID === 'activity-1') {
          return '#123456';
        }
        if (activityID === 'activity-2') {
          return '#abcdef';
        }
        if (activityID === 'activity-3') {
          return '#654321';
        }
        if (activityID === 'activity-4') {
          return '#fedcba';
        }
        return '#16B4EA';
      }),
      getAutomaticActivityColor: vi.fn((_activities, activity) => {
        const activityID = activity?.getID?.();
        if (activityID === 'activity-1') {
          return '#123456';
        }
        if (activityID === 'activity-2') {
          return '#abcdef';
        }
        if (activityID === 'activity-3') {
          return '#654321';
        }
        if (activityID === 'activity-4') {
          return '#fedcba';
        }
        return '#16B4EA';
      }),
      getColorForActivityTypeByActivityTypeGroup: vi.fn().mockReturnValue('#16B4EA'),
      getDifferenceColor: vi.fn((value: number) => {
        if (value <= 2) {
          return AppColors.Green;
        }
        if (value <= 5) {
          return AppColors.Orange;
        }
        return AppColors.Red;
      }),
    };
    benchmarkFlowServiceMock = {
      openBenchmarkReport: vi.fn().mockResolvedValue(undefined),
      openBenchmarkSelectionDialog: vi.fn().mockResolvedValue(undefined),
    };
    hapticsServiceMock = {
      selection: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    };
    benchmarkReviewServiceMock = {
      normalizeTags: vi.fn((tags: unknown) => Array.isArray(tags)
        ? tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean)
        : []),
      getEventTags: vi.fn((event: AppEventInterface) => Array.isArray(event.benchmarkReviewTags) ? event.benchmarkReviewTags : []),
      saveEventTags: vi.fn(async (_user: User, event: AppEventInterface, tags: unknown) => {
        const normalizedTags = benchmarkReviewServiceMock.normalizeTags(tags);
        event.benchmarkReviewTags = normalizedTags;
        return normalizedTags;
      }),
    };
    deviceColorByNameState = {};
    deviceColorPreferenceServiceMock = {
      deviceColorByName: vi.fn(() => deviceColorByNameState),
      normalizeDeviceColorKey: vi.fn((name: string) => normalizeDeviceColorKey(name)),
    };
    analyticsServiceMock = {
      logToolCompareCreate: vi.fn(),
      logToolCompareFileSelection: vi.fn(),
      logToolCompareSavedAction: vi.fn(),
      logToolCompareSignIn: vi.fn(),
    };
    loggerMock = {
      warn: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ToolsComparePageComponent, RouterTestingModule.withRoutes([]), NoopAnimationsModule],
      providers: [
        {
          provide: AppAuthService,
          useValue: authServiceMock,
        },
        { provide: AppToolsComparisonService, useValue: comparisonServiceMock },
        { provide: AppAnalyticsService, useValue: analyticsServiceMock },
        { provide: AppBenchmarkFlowService, useValue: benchmarkFlowServiceMock },
        { provide: AppHapticsService, useValue: hapticsServiceMock },
        { provide: BenchmarkReviewService, useValue: benchmarkReviewServiceMock },
        { provide: AppEventService, useValue: eventServiceMock },
        { provide: AppEventColorService, useValue: eventColorServiceMock },
        { provide: AppDeviceColorPreferenceService, useValue: deviceColorPreferenceServiceMock },
        { provide: LoggerService, useValue: loggerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
      ],
    }).compileComponents();

    routerNavigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(ToolsComparePageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the public compare tool and guest sign-in state', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Compare FIT, GPX, and TCX files');
    expect(text).toContain('Sign in to compare files');
    expect(text).toContain('Benchmark comparisons are saved to your account');
    expect(text).toContain('Comparison files are handled after sign-in');
    expect(text).toContain('Review file recordings without rebuilding a dashboard');
    expect(text).toContain('File-based comparisons');
    expect(text).toContain('Reviewer metrics');
    expect(text).toContain('Device review notes');
    expect(text).not.toContain('New comparison');
    expect(text).not.toContain('Saved comparisons');
    expect(text).not.toContain('Select Files');
    expect(text).not.toContain('No files selected');
    expect(text).not.toContain('Sign in to view saved comparisons.');
    expect(fixture.nativeElement.querySelector('a[routerlink="/features/workout-file-comparison"], a[ng-reflect-router-link="/features/workout-file-comparison"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('a[routerlink="/features/sports-watch-benchmark"], a[ng-reflect-router-link="/features/sports-watch-benchmark"]')).toBeTruthy();
    expect(component.guestSignInRedirectUrl).toBe('/tools/compare');
    expect(comparisonServiceMock.getBenchmarkComparisonPage).not.toHaveBeenCalled();
  });

  it('does not render the signed-in workspace for guests', () => {
    expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Sign in to view saved comparisons.');
  });

  it('renders a neutral auth state before the route auth resolver completes', () => {
    component.authResolved.set(false);
    component.firebaseSignedIn.set(false);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Checking account');
    expect(text).not.toContain('Sign in to compare files');
    expect(text).not.toContain('New comparison');
  });

  it('renders the signed-in workspace while the app user profile is loading', () => {
    component.authResolved.set(true);
    component.firebaseSignedIn.set(true);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Compare files');
    expect(text).toContain('New comparison');
    expect(text).toContain('Loading your account');
    expect(text).toContain('Loading comparisons');
    expect(text).not.toContain('Sign in to compare files');
    expect(text).not.toContain('Review file recordings without rebuilding a dashboard');
    expect(comparisonServiceMock.getBenchmarkComparisonPage).not.toHaveBeenCalled();

    const addFilesButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find(button => button.textContent?.includes('Add files')) as HTMLButtonElement | undefined;
    expect(addFilesButton?.disabled).toBe(true);
  });

  it('returns to the guest experience when auth signs out before the app user profile loads', () => {
    component.authResolved.set(true);
    component.firebaseSignedIn.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Loading your account');

    userSubject.next(null);
    fixture.detectChanges();

    expect(component.firebaseSignedIn()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Sign in to compare files');
    expect(fixture.nativeElement.textContent).not.toContain('Loading your account');
  });

  it('loads the first saved benchmark comparison page for signed-in users', async () => {
    const user = new User('user-1');
    userSubject.next(user);
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Compare files');
    expect(fixture.nativeElement.textContent).toContain('New comparison');
    expect(fixture.nativeElement.textContent).toContain('No saved comparisons yet');
    expect(fixture.nativeElement.textContent).not.toContain('Previous comparisons');
    expect(fixture.nativeElement.textContent).not.toContain('Create one saved benchmark event from multiple source files');
    expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(comparisonServiceMock.getBenchmarkComparisonCount).toHaveBeenCalledWith(user);
    expect(comparisonServiceMock.getBenchmarkComparisonPage).toHaveBeenCalledWith(user, { pageSize: 25 });
  });

  it('loads later saved benchmark comparison pages with stored cursors', async () => {
    const user = new User('user-1');
    const nextCursor = { id: 'page-1-last-doc' };
    const firstPageEvents = Array.from({ length: 25 }, (_value, index) =>
      makeComparisonEvent(`page-1-comparison-${index + 1}`, {
        startDate: new Date(Date.UTC(2026, 0, 31 - index)),
      }),
    );
    const secondPageEvent = makeComparisonEvent('page-2-comparison-1', {
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    });
    comparisonServiceMock.getBenchmarkComparisonCount.mockReturnValue(of(26));
    comparisonServiceMock.getBenchmarkComparisonPage
      .mockReturnValueOnce(of({
        events: firstPageEvents,
        nextCursor,
        hasMore: true,
      }))
      .mockReturnValueOnce(of({
        events: [secondPageEvent],
        nextCursor: null,
        hasMore: false,
      }));

    userSubject.next(user);
    await Promise.resolve();
    await Promise.resolve();

    expect(component.comparisonPaginatorLength()).toBe(26);
    expect(component.paginatedComparisonItems()).toHaveLength(25);

    await component.onComparisonPageChange({
      pageIndex: 1,
      pageSize: 25,
      length: 26,
      previousPageIndex: 0,
    });

    expect(comparisonServiceMock.getBenchmarkComparisonPage).toHaveBeenNthCalledWith(1, user, {
      pageSize: 25,
    });
    expect(comparisonServiceMock.getBenchmarkComparisonPage).toHaveBeenNthCalledWith(2, user, {
      pageSize: 25,
      cursor: nextCursor,
    });
    expect(component.paginatedComparisonItems().map(item => item.id)).toEqual(['page-2-comparison-1']);
  });

  it('uses warning haptics when user pagination cannot load the requested comparison page', async () => {
    const user = new User('user-1');
    const nextCursor = { id: 'page-1-last-doc' };
    const firstPageEvents = Array.from({ length: 25 }, (_value, index) =>
      makeComparisonEvent(`page-1-comparison-${index + 1}`, {
        startDate: new Date(Date.UTC(2026, 0, 31 - index)),
      }),
    );
    const pageError = { message: 'page load failed' };
    comparisonServiceMock.getBenchmarkComparisonCount.mockReturnValue(of(26));
    comparisonServiceMock.getBenchmarkComparisonPage
      .mockReturnValueOnce(of({
        events: firstPageEvents,
        nextCursor,
        hasMore: true,
      }))
      .mockReturnValueOnce(throwError(() => pageError));

    userSubject.next(user);
    await Promise.resolve();
    await Promise.resolve();

    await component.onComparisonPageChange({
      pageIndex: 1,
      pageSize: 25,
      length: 26,
      previousPageIndex: 0,
    });

    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[ToolsComparePageComponent] Could not load saved comparisons.',
      pageError,
    );
    expect(component.comparisonPage()).toEqual({ pageIndex: 0, pageSize: 25 });
    expect(hapticsServiceMock.warning).toHaveBeenCalled();
  });

  it('renders the saved comparisons panel before upload controls when the saved route is focused', async () => {
    Object.defineProperty(component, 'showSavedComparisonsFirst', {
      configurable: true,
      value: true,
    });
    userSubject.next(new User('user-1'));
    await Promise.resolve();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text.indexOf('No saved comparisons yet')).toBeLessThan(text.indexOf('New comparison'));
    expect(text).not.toContain('Previous comparisons');
  });

  it('clears the saved comparisons loading state after the first page resolves', async () => {
    const savedPage$ = new Subject<any>();
    comparisonServiceMock.getBenchmarkComparisonPage.mockReturnValue(savedPage$);

    userSubject.next(new User('user-1'));
    expect(component.isLoadingComparisons()).toBe(true);

    savedPage$.next({
      events: [],
      nextCursor: null,
      hasMore: false,
    });
    savedPage$.complete();
    await Promise.resolve();

    expect(component.isLoadingComparisons()).toBe(false);
  });

  it('logs saved comparison load errors so missing-index URLs are visible', async () => {
    const missingIndexError = {
      code: 'failed-precondition',
      message: 'The query requires an index. Create it here: https://console.firebase.google.com/index-url',
    };
    comparisonServiceMock.getBenchmarkComparisonPage.mockReturnValue(throwError(() => missingIndexError));

    userSubject.next(new User('user-1'));
    await Promise.resolve();

    expect(component.isLoadingComparisons()).toBe(false);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[ToolsComparePageComponent] Could not load saved comparisons.',
      missingIndexError,
    );
    expect(hapticsServiceMock.error).not.toHaveBeenCalled();
    expect(hapticsServiceMock.warning).not.toHaveBeenCalled();
  });

  it('clears staged files and title when the user signs out', () => {
    userSubject.next(new User('user-1'));
    component.selectedFiles.set([
      new File([new Uint8Array([1])], 'staged.fit'),
      new File([new Uint8Array([2])], 'staged.gpx'),
    ]);
    component.comparisonTitle.set('Session files');

    userSubject.next(null);

    expect(component.selectedFiles()).toEqual([]);
    expect(component.comparisonTitle()).toBe('');
    expect(component.canCreateComparison()).toBe(false);
  });

  it('clears previous user comparison and file state when the signed-in user changes', () => {
    userSubject.next(new User('user-1'));
    component.comparisons.set([
      {
        getID: () => 'user-1-comparison',
        name: 'User 1 comparison',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      } as any,
    ]);
    component.selectedFiles.set([
      new File([new Uint8Array([1])], 'user-1.fit'),
      new File([new Uint8Array([2])], 'user-1.gpx'),
    ]);
    component.comparisonTitle.set('User 1 files');
    component.descriptionDrafts.set({ 'user-1-comparison': 'Draft note' });
    component.editingDescriptionEventID.set('user-1-comparison');

    userSubject.next(new User('user-2'));

    expect(component.comparisons()).toEqual([]);
    expect(component.selectedFiles()).toEqual([]);
    expect(component.comparisonTitle()).toBe('');
    expect(component.descriptionDrafts()).toEqual({});
    expect(component.editingDescriptionEventID()).toBeNull();
  });

  it('sends guests to login when they try to create a comparison', async () => {
    await component.createComparison();

    expect(analyticsServiceMock.logToolCompareSignIn).toHaveBeenCalledWith('guest_create', 'compare');
    expect(authServiceMock.redirectUrl).toBe('/tools/compare');
    expect(routerNavigateSpy).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/tools/compare' },
    });
    expect(hapticsServiceMock.selection).toHaveBeenCalled();
  });

  it('ignores guest file selection so uploads are not staged before sign-in', () => {
    const inputTarget = {
      files: [new File([new Uint8Array([1])], 'guest.fit')],
      value: 'guest.fit',
    };

    component.onFilesSelected({ target: inputTarget } as unknown as Event);

    expect(inputTarget.value).toBe('');
    expect(component.selectedFiles()).toEqual([]);
    expect(component.canCreateComparison()).toBe(false);
    expect(analyticsServiceMock.logToolCompareFileSelection).not.toHaveBeenCalled();
    expect(hapticsServiceMock.warning).toHaveBeenCalled();
  });

  it('logs comparison file selection summaries without filenames', () => {
    userSubject.next(new User('user-1'));
    const inputTarget = {
      files: [
        new File([new Uint8Array([1])], 'review-alpha.fit'),
        new File([new Uint8Array([2])], 'review-beta.gpx.gz'),
        new File([new Uint8Array([3])], 'notes.txt'),
      ],
      value: 'selected',
    };

    component.onFilesSelected({ target: inputTarget } as unknown as Event);

    expect(analyticsServiceMock.logToolCompareFileSelection).toHaveBeenCalledWith({
      selectedCount: 3,
      acceptedCount: 2,
      rejectedCount: 1,
      fileCountAfterSelection: 2,
      fileTypes: ['fit', 'gpx'],
      compressedCount: 1,
      limitReached: false,
    });
    expect(hapticsServiceMock.warning).toHaveBeenCalled();
    expect(inputTarget.value).toBe('');
  });

  it('uses haptics for accepted staged files and file list changes', () => {
    userSubject.next(new User('user-1'));
    const inputTarget = {
      files: [
        new File([new Uint8Array([1])], 'review-alpha.fit'),
        new File([new Uint8Array([2])], 'review-beta.gpx'),
      ],
      value: 'selected',
    };

    component.onFilesSelected({ target: inputTarget } as unknown as Event);
    component.removeFile(0);
    component.clearFiles();

    expect(hapticsServiceMock.success).toHaveBeenCalledTimes(1);
    expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(2);
  });

  it('creates a comparison and opens event details with benchmark auto-open', async () => {
    const user = new User('user-1');
    userSubject.next(user);
    const firstFile = new File([new Uint8Array([1])], 'one.fit');
    const secondFile = new File([new Uint8Array([2])], 'two.gpx');
    component.selectedFiles.set([firstFile, secondFile]);
    component.comparisonTitle.set('Review pair');

    await component.createComparison();

    expect(comparisonServiceMock.createComparison).toHaveBeenCalledWith([firstFile, secondFile], 'Review pair');
    expect(analyticsServiceMock.logToolCompareCreate).toHaveBeenCalledWith('start', {
      fileCount: 2,
      hasCustomTitle: true,
    });
    expect(analyticsServiceMock.logToolCompareCreate).toHaveBeenCalledWith('success', {
      fileCount: 2,
      hasCustomTitle: true,
      alreadyExists: false,
    });
    expect(routerNavigateSpy).toHaveBeenCalledWith(['/user', 'user-1', 'event', 'event-1'], {
      queryParams: { benchmark: '1' },
    });
    expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(1);
    expect(hapticsServiceMock.success).toHaveBeenCalledTimes(1);
  });

  it('logs validation failures before comparison creation starts', async () => {
    userSubject.next(new User('user-1'));
    component.selectedFiles.set([
      new File([new Uint8Array([1])], 'one.txt'),
      new File([new Uint8Array([2])], 'two.txt'),
    ]);
    comparisonServiceMock.validateFiles.mockReturnValueOnce('Only FIT, GPX, and TCX files are supported for comparisons.');

    await component.createComparison();

    expect(comparisonServiceMock.createComparison).not.toHaveBeenCalled();
    expect(analyticsServiceMock.logToolCompareCreate).toHaveBeenCalledWith('validation_failure', {
      fileCount: 2,
      hasCustomTitle: false,
      errorCategory: 'unsupported_format',
    });
    expect(hapticsServiceMock.warning).toHaveBeenCalled();
  });

  it('caps staged files at the comparison upload limit', () => {
    userSubject.next(new User('user-1'));

    const files = Array.from({ length: 12 }, (_value, index) =>
      new File([new Uint8Array([index])], `file-${index}.fit`),
    );

    (component as any).addFiles(files);

    expect(component.selectedFiles()).toHaveLength(10);
  });

  it('does not change selected files while a comparison is being created', () => {
    const initialFile = new File([new Uint8Array([1])], 'initial.fit');
    component.selectedFiles.set([initialFile]);
    component.comparisonTitle.set('Locked title');
    component.isCreating.set(true);

    (component as any).addFiles([
      new File([new Uint8Array([2])], 'next.gpx'),
    ]);
    component.removeFile(0);
    component.clearFiles();
    component.updateTitle('Changed title');

    expect(component.selectedFiles()).toEqual([initialFile]);
    expect(component.comparisonTitle()).toBe('Locked title');
  });

  it('does not start a second comparison while creation is already in progress', async () => {
    component.isCreating.set(true);

    await component.createComparison();

    expect(comparisonServiceMock.createComparison).not.toHaveBeenCalled();
    expect(routerNavigateSpy).not.toHaveBeenCalled();
  });

  it('keeps files with matching browser metadata so backend content validation can decide duplicates', () => {
    userSubject.next(new User('user-1'));

    const files = [
      new File([new Uint8Array([1])], 'activity.fit', { lastModified: 1000 }),
      new File([new Uint8Array([2])], 'activity.fit', { lastModified: 1000 }),
    ];

    (component as any).addFiles(files);

    expect(component.selectedFiles()).toEqual(files);
  });

  it('marks saved comparison reports only when actual benchmark result data exists', () => {
    component.comparisons.set([
      {
        getID: () => 'stale-has-benchmark',
        name: 'Stale flag',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        hasBenchmark: true,
        benchmarkResults: {},
      } as any,
      {
        getID: () => 'legacy-result',
        name: 'Legacy result',
        startDate: new Date('2026-01-02T00:00:00.000Z'),
        benchmarkResult: { score: 90 },
      } as any,
    ]);

    expect(component.comparisonItems()[0]).toEqual(expect.objectContaining({
      id: 'stale-has-benchmark',
      hasReport: false,
      reportCount: 0,
    }));
    expect(component.comparisonItems()[1]).toEqual(expect.objectContaining({
      id: 'legacy-result',
      hasReport: true,
      reportCount: 1,
    }));
  });

  it('logs saved comparison open actions without event metadata', async () => {
    const user = new User('user-1');
    const reportResult = makeBenchmarkResult({
      referenceId: 'activity-1',
      testId: 'activity-2',
      timestamp: new Date('2026-01-02T00:00:00.000Z'),
    });
    userSubject.next(user);
    await Promise.resolve();
    await Promise.resolve();
    component.comparisons.set([
      makeComparisonEvent('ready-comparison', {
        title: 'Private title',
        description: 'Private note',
        benchmarkResults: { 'activity-1_activity-2': reportResult },
      }),
      makeComparisonEvent('draft-comparison', {
        title: 'Draft title',
        activities: [
          makeActivity('activity-1', {
            deviceName: 'Garmin Edge',
            activityType: 'Cycling',
          }),
          makeActivity('activity-2', {
            deviceName: 'Suunto Race',
            activityType: 'Cycling',
          }),
        ],
      }),
    ]);

    await component.openComparison(component.comparisonItems()[0], false);
    await component.openComparison(component.comparisonItems()[1], true);
    await component.openComparison(component.comparisonItems()[0], true);

    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('open_details', {
      hasReport: true,
      reportCount: 1,
      filterActive: false,
      resultCount: 2,
    });
    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('run_report', {
      hasReport: false,
      reportCount: 0,
      filterActive: false,
      resultCount: 2,
    });
    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('open_report', {
      hasReport: true,
      reportCount: 1,
      filterActive: false,
      resultCount: 2,
    });
    expect(routerNavigateSpy).toHaveBeenCalledWith(['/user', 'user-1', 'event', 'ready-comparison'], {
      queryParams: undefined,
    });
    expect(routerNavigateSpy).toHaveBeenCalledTimes(1);
    expect(benchmarkFlowServiceMock.openBenchmarkSelectionDialog).toHaveBeenCalledWith(expect.objectContaining({
      event: component.comparisonItems()[1].event,
      persistEvent: component.comparisonItems()[1].event,
      user,
      initialSelection: component.comparisonItems()[1].event.getActivities().slice(0, 2),
      hydrateStreamsForGeneration: true,
    }));
    expect(benchmarkFlowServiceMock.openBenchmarkReport).toHaveBeenCalledWith(expect.objectContaining({
      event: component.comparisonItems()[0].event,
      persistEvent: component.comparisonItems()[0].event,
      user,
      result: reportResult,
      hydrateStreamsForGeneration: true,
    }));
    const reportConfig = benchmarkFlowServiceMock.openBenchmarkReport.mock.calls[0][0];
    reportConfig.onEventTagsSaved?.(['firmware']);
    expect(component.comparisonItems()[0].benchmarkReviewTags).toEqual(['firmware']);
    expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(3);
  });

  it('updates saved comparison report metadata after an in-place benchmark run', async () => {
    const user = new User('user-1');
    const generatedResult = makeBenchmarkResult({
      referenceId: 'activity-1',
      testId: 'activity-2',
      referenceName: 'Garmin Edge',
      testName: 'Suunto Race',
      timestamp: new Date('2026-01-03T00:00:00.000Z'),
    });
    benchmarkFlowServiceMock.openBenchmarkSelectionDialog.mockImplementationOnce(async (config: { onResult?: (result: BenchmarkResult) => void }) => {
      config.onResult?.(generatedResult);
    });
    userSubject.next(user);
    await Promise.resolve();
    await Promise.resolve();
    component.comparisons.set([
      makeComparisonEvent('draft-comparison', {
        title: 'Draft title',
      }),
    ]);

    await component.openComparison(component.comparisonItems()[0], true);

    const item = component.comparisonItems()[0];
    expect(item.hasReport).toBe(true);
    expect(item.reportCount).toBe(1);
    expect(item.event.benchmarkResults?.['activity-1_activity-2']).toBe(generatedResult);
    expect(item.event.benchmarkLatestAt).toBe(generatedResult.timestamp);
    expect(item.event.benchmarkDevices).toEqual(['garmin edge', 'suunto race']);
    expect(hapticsServiceMock.success).toHaveBeenCalled();
  });

  it('runs a benchmark from an empty metric cell with a loading state', async () => {
    const user = new User('user-1');
    let resolveFlow: (() => void) | null = null;
    const flowPromise = new Promise<void>((resolve) => {
      resolveFlow = resolve;
    });
    benchmarkFlowServiceMock.openBenchmarkSelectionDialog.mockReturnValueOnce(flowPromise);
    userSubject.next(user);
    await Promise.resolve();
    await Promise.resolve();
    component.comparisons.set([
      makeComparisonEvent('draft-comparison', {
        title: 'Draft title',
        activities: [
          makeActivity('activity-1', {
            deviceName: 'Garmin Edge',
            activityType: 'Cycling',
          }),
          makeActivity('activity-2', {
            deviceName: 'Suunto Race',
            activityType: 'Cycling',
          }),
        ],
      }),
    ]);
    fixture.detectChanges();

    const metricButton = (fixture.nativeElement as HTMLElement).querySelector('.mat-column-gnss .benchmark-summary-action') as HTMLButtonElement;
    expect(metricButton).toBeTruthy();
    expect(metricButton.getAttribute('title')).toContain('Run the benchmark report');
    expect(metricButton.textContent).toContain('Run');

    metricButton.click();
    fixture.detectChanges();

    expect(component.benchmarkingEventID()).toBe('draft-comparison');
    expect((fixture.nativeElement as HTMLElement).querySelector('.mat-column-gnss mat-progress-spinner')).toBeTruthy();
    expect(benchmarkFlowServiceMock.openBenchmarkSelectionDialog).toHaveBeenCalledWith(expect.objectContaining({
      event: component.comparisonItems()[0].event,
      persistEvent: component.comparisonItems()[0].event,
      user,
      initialSelection: component.comparisonItems()[0].event.getActivities().slice(0, 2),
      hydrateStreamsForGeneration: true,
    }));
    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('run_report', {
      hasReport: false,
      reportCount: 0,
      filterActive: false,
      resultCount: 1,
    });

    await component.openComparison(component.comparisonItems()[0], true);
    expect(benchmarkFlowServiceMock.openBenchmarkSelectionDialog).toHaveBeenCalledTimes(1);

    resolveFlow?.();
    await flowPromise;
    await Promise.resolve();

    expect(component.benchmarkingEventID()).toBeNull();
  });

  it('reruns a benchmark from a legacy GNSS metric cell with missing mean fields', async () => {
    const user = new User('user-1');
    userSubject.next(user);
    await Promise.resolve();
    await Promise.resolve();
    component.comparisons.set([
      makeComparisonEvent('legacy-gnss-report', {
        title: 'Legacy GNSS report',
        activities: [
          makeActivity('activity-1', {
            deviceName: 'Garmin Edge',
            activityType: 'Cycling',
          }),
          makeActivity('activity-2', {
            deviceName: 'Suunto Race',
            activityType: 'Cycling',
          }),
        ],
        benchmarkResults: {
          'activity-1_activity-2': makeBenchmarkResult({
            referenceId: 'activity-1',
            testId: 'activity-2',
            metrics: {
              gnss: {
                cep50: 42.3,
                rmse: 42.6,
              },
            },
          }),
        },
      }),
    ]);
    fixture.detectChanges();

    const item = component.comparisonItems()[0];
    expect(item.gnssBenchmark.canRerunReport).toBe(true);
    expect(item.gnssBenchmark.title).toContain('Click to rerun the benchmark');

    const metricButton = (fixture.nativeElement as HTMLElement).querySelector('.mat-column-gnss .benchmark-rerun-action') as HTMLButtonElement;
    expect(metricButton).toBeTruthy();
    expect(metricButton.textContent).toContain('Rerun');
    expect(metricButton.getAttribute('aria-label')).toContain('Rerun benchmark report');

    metricButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(benchmarkFlowServiceMock.openBenchmarkSelectionDialog).toHaveBeenCalledWith(expect.objectContaining({
      event: item.event,
      persistEvent: item.event,
      user,
      initialSelection: item.event.getActivities().slice(0, 2),
      hydrateStreamsForGeneration: true,
    }));
    expect(benchmarkFlowServiceMock.openBenchmarkReport).not.toHaveBeenCalled();
    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('rerun_report', {
      hasReport: true,
      reportCount: 1,
      filterActive: false,
      resultCount: 1,
    });
    expect(hapticsServiceMock.selection).toHaveBeenCalled();
  });

  it('keeps row loading feedback active while benchmark generation callbacks are pending', async () => {
    const user = new User('user-1');
    let capturedConfig: {
      onGenerationStart?: () => void;
      onGenerationComplete?: (status: 'success' | 'failure') => void;
    } | null = null;
    benchmarkFlowServiceMock.openBenchmarkSelectionDialog.mockImplementationOnce(async (config) => {
      capturedConfig = config;
    });
    userSubject.next(user);
    await Promise.resolve();
    await Promise.resolve();
    component.comparisons.set([
      makeComparisonEvent('draft-comparison', {
        title: 'Draft title',
        activities: [
          makeActivity('activity-1', {
            deviceName: 'Garmin Edge',
            activityType: 'Cycling',
          }),
          makeActivity('activity-2', {
            deviceName: 'Suunto Race',
            activityType: 'Cycling',
          }),
        ],
      }),
    ]);

    await component.openBenchmarkFromMetricCell(component.comparisonItems()[0]);
    expect(component.benchmarkingEventID()).toBeNull();

    capturedConfig?.onGenerationStart?.();
    fixture.detectChanges();

    expect(component.benchmarkingEventID()).toBe('draft-comparison');
    expect((fixture.nativeElement as HTMLElement).querySelector('.mat-column-gnss mat-progress-spinner')).toBeTruthy();

    capturedConfig?.onGenerationComplete?.('failure');
    fixture.detectChanges();

    expect(component.benchmarkingEventID()).toBeNull();
    expect(hapticsServiceMock.warning).toHaveBeenCalled();
  });

  it('filters, sorts, and paginates previous comparison rows', async () => {
    component.comparisons.set([
      makeComparisonEvent('older-draft', {
        title: 'Older draft',
        description: 'Lab test',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        sourceFilesCount: 2,
      }),
      makeComparisonEvent('new-ready', {
        title: 'New ready',
        description: 'Race file',
        startDate: new Date('2026-01-03T00:00:00.000Z'),
        sourceFilesCount: 4,
        benchmarkResults: { 'a_b': { score: 90 } },
      }),
      makeComparisonEvent('middle-ready', {
        title: 'Middle ready',
        description: 'Review file',
        startDate: new Date('2026-01-02T00:00:00.000Z'),
        sourceFilesCount: 3,
        benchmarkResults: { 'c_d': { score: 85 }, 'e_f': { score: 80 } },
      }),
    ]);

    expect(component.sortedComparisonItems().map(item => item.id)).toEqual([
      'new-ready',
      'middle-ready',
      'older-draft',
    ]);
    expect(component.displayedComparisonColumns).not.toContain('activities');
    const tableHeaders = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('th'))
      .map(header => header.textContent?.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    expect(tableHeaders).not.toContain('Activities');

    component.onComparisonSortChange({ active: 'sourceFiles', direction: 'asc' });
    expect(component.sortedComparisonItems().map(item => item.id)).toEqual([
      'older-draft',
      'middle-ready',
      'new-ready',
    ]);
    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('sort', {
      sortColumn: 'sourceFiles',
      sortDirection: 'asc',
      filterActive: false,
      resultCount: 3,
    });
    component.comparisonTotalCount.set(50);
    expect(component.comparisonResultSummary()).toBe('3 of 50 loaded; sorting loaded rows');

    expect(component.comparisonPage()).toEqual({
      pageIndex: 0,
      pageSize: 25,
    });
    expect(component.comparisonPageSizeOptions).toEqual([10, 25, 50, 100]);

    component.comparisonPage.set({ pageIndex: 0, pageSize: 1 });
    await component.onComparisonPageChange({ pageIndex: 1, pageSize: 1, length: 3, previousPageIndex: 0 });
    expect(component.paginatedComparisonItems().map(item => item.id)).toEqual(['middle-ready']);
    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('page', {
      pageIndex: 1,
      pageSize: 1,
      filterActive: false,
      resultCount: 3,
    });

    component.updateComparisonFilter('race');
    expect(component.filteredComparisonItems().map(item => item.id)).toEqual(['new-ready']);
    expect(component.comparisonResultSummary()).toBe('1 of 3 loaded comparisons');
    expect(component.comparisonPage().pageIndex).toBe(0);
    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('filter', {
      status: 'applied',
      filterActive: true,
      resultCount: 1,
    });
    expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(3);
  });

  it('labels saved comparison filtering as scoped to loaded rows', async () => {
    userSubject.next(new User('user-1'));
    await Promise.resolve();
    await Promise.resolve();
    component.comparisons.set([
      makeComparisonEvent('comparison-1', {
        title: 'Morning reference',
      }),
      makeComparisonEvent('comparison-2', {
        title: 'Evening candidate',
      }),
    ]);
    component.comparisonTotalCount.set(40);
    component.updateComparisonFilter('missing');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Filter loaded comparisons');
    expect(text).toContain('0 of 2 loaded comparisons');
    expect(text).toContain('No loaded comparisons match this filter');
    expect(component.comparisonPaginatorLength()).toBe(0);
  });

  it('exposes the full previous comparison title when the table truncates it', () => {
    const fullTitle = 'Benchmark comparison: morning-device-reference.fit vs evening-device-candidate.gpx';
    userSubject.next(new User('user-1'));
    component.comparisons.set([
      makeComparisonEvent('comparison-1', {
        title: fullTitle,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ]);
    fixture.detectChanges();

    const titleCell = fixture.nativeElement.querySelector('.title-cell') as HTMLElement;
    expect(titleCell.getAttribute('title')).toBe(fullTitle);
  });

  it('shows previous comparison devices with sorting, filtering, and tooltip text', () => {
    userSubject.next(new User('user-1'));
    component.comparisons.set([
      makeComparisonEvent('report-devices', {
        title: 'Report devices',
        benchmarkResults: {
          pair: {
            referenceName: 'Garmin Forerunner 265',
            testName: 'COROS PACE 3',
          },
        },
      }),
      makeComparisonEvent('metadata-devices', {
        title: 'Metadata devices',
        benchmarkDevices: ['suunto race'],
      }),
      makeComparisonEvent('unknown-devices', {
        title: 'Unknown devices',
      }),
    ]);
    fixture.detectChanges();

    expect(component.comparisonItems().map(item => ({
      id: item.id,
      devicesLabel: item.devicesLabel,
    }))).toEqual([
      { id: 'report-devices', devicesLabel: 'Garmin Forerunner 265, COROS PACE 3' },
      { id: 'metadata-devices', devicesLabel: 'Suunto Race' },
      { id: 'unknown-devices', devicesLabel: 'Devices unknown' },
    ]);

    const devicesCell = fixture.nativeElement.querySelector('.devices-cell') as HTMLElement;
    expect(devicesCell.getAttribute('title')).toBe('Garmin Forerunner 265, COROS PACE 3');

    component.onComparisonSortChange({ active: 'devices', direction: 'asc' });
    expect(component.sortedComparisonItems().map(item => item.id)).toEqual([
      'report-devices',
      'metadata-devices',
      'unknown-devices',
    ]);

    component.updateComparisonFilter('pace 3');
    expect(component.filteredComparisonItems().map(item => item.id)).toEqual(['report-devices']);
  });

  it('shows sortable per-device activity type, distance, ascent, and descent summaries', () => {
    const user = new User('user-1');
    (user as User & { settings: { unitSettings: null } }).settings = { unitSettings: null };
    userSubject.next(user);
    component.comparisons.set([
      makeComparisonEvent('long-course', {
        title: 'Long course',
        activities: [
          makeActivity('activity-1', {
            deviceName: 'Garmin Edge',
            swInfo: '3130',
            activityType: 'Cycling',
            distance: 10000,
            ascent: 120,
            descent: 118,
          }),
          makeActivity('activity-2', {
            deviceName: 'Suunto Race',
            activityType: 'Cycling',
            distance: 10020,
            ascent: 121,
            descent: 117,
          }),
        ],
      }),
      makeComparisonEvent('short-course', {
        title: 'Short course',
        activities: [
          makeActivity('activity-3', {
            deviceName: 'Polar Vantage',
            activityType: 'Running',
            distance: 5000,
            ascent: 30,
            descent: 28,
          }),
        ],
      }),
      makeComparisonEvent('unknown-course', {
        title: 'Unknown course metrics',
        activities: [
          makeActivity('activity-4', {
            deviceName: 'Wahoo ELEMNT',
            activityType: 'Cycling',
          }),
        ],
      }),
    ]);
    fixture.detectChanges();

    const longCourse = component.comparisonItems().find(item => item.id === 'long-course');
    expect(longCourse?.activitySummaries.map(summary => summary.id)).toEqual(['activity-1-0', 'activity-2-1']);
    expect(longCourse?.activityTypesLabel).toBe('Cycling');
    expect(longCourse?.activitySummaries.map(summary => ({
      deviceLabel: summary.deviceLabel,
      deviceColor: summary.deviceColor,
      activityTypeLabel: summary.activityTypeLabel,
      activityTypeIconValue: summary.activityTypeIconValue,
      distanceLabel: summary.distanceLabel,
      ascentLabel: summary.ascentLabel,
      descentLabel: summary.descentLabel,
    }))).toEqual([
      {
        deviceLabel: 'Garmin Edge 3130',
        deviceColor: '#123456',
        activityTypeLabel: 'Cycling',
        activityTypeIconValue: 'Cycling',
        distanceLabel: '10.00 km',
        ascentLabel: '120 m',
        descentLabel: '118 m',
      },
      {
        deviceLabel: 'Suunto Race',
        deviceColor: '#abcdef',
        activityTypeLabel: 'Cycling',
        activityTypeIconValue: 'Cycling',
        distanceLabel: '10.02 km',
        ascentLabel: '121 m',
        descentLabel: '117 m',
      },
    ]);

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Distance');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Ascent');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Descent');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Garmin Edge 3130');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('10.02 km');
    const deviceLines = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.device-summary-line'))
      .map(line => ({
        label: line.querySelector('.device-name-label')?.textContent?.trim(),
        style: line.getAttribute('style') || '',
      }));
    expect(deviceLines).toContainEqual({ label: 'Garmin Edge 3130', style: '--device-accent-color: #123456;' });
    expect(deviceLines).toContainEqual({ label: 'Suunto Race', style: '--device-accent-color: #abcdef;' });
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.device-name-swatch').length).toBeGreaterThanOrEqual(2);
    const sportTypeLines = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.summary-type-line'))
      .map(line => line.querySelector('.summary-type-value')?.textContent?.trim());
    expect((fixture.nativeElement as HTMLElement).querySelector('.summary-type-device')).toBeNull();
    expect(sportTypeLines).toContain('Cycling');
    expect(sportTypeLines).toContain('Running');
    const activityTypeIcons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.summary-type-line app-activity-type-icon'));
    expect(activityTypeIcons.length).toBeGreaterThanOrEqual(4);
    const firstActivityTypeIconStyle = activityTypeIcons[0].querySelector('mat-icon')?.getAttribute('style') || '';
    expect(firstActivityTypeIconStyle).toContain('16px');
    expect(firstActivityTypeIconStyle.toLowerCase()).toMatch(/#16b4ea|rgb\(22,\s*180,\s*234\)/);
    expect(eventColorServiceMock.getColorForActivityTypeByActivityTypeGroup).toHaveBeenCalled();
    expect(longCourse?.activityTypesTitle).toBe('Cycling');
    expect(longCourse?.distanceTitle).toContain('Suunto Race: 10.02 km');

    component.onComparisonSortChange({ active: 'distance', direction: 'asc' });
    expect(component.sortedComparisonItems().map(item => item.id)).toEqual([
      'short-course',
      'long-course',
      'unknown-course',
    ]);

    component.onComparisonSortChange({ active: 'distance', direction: 'desc' });
    expect(component.sortedComparisonItems().map(item => item.id)).toEqual([
      'long-course',
      'short-course',
      'unknown-course',
    ]);

    component.onComparisonSortChange({ active: 'ascent', direction: 'desc' });
    expect(component.sortedComparisonItems().map(item => item.id)).toEqual([
      'long-course',
      'short-course',
      'unknown-course',
    ]);

    component.updateComparisonFilter('cycling');
    expect(component.filteredComparisonItems().map(item => item.id)).toEqual(['long-course', 'unknown-course']);

    expect(component.comparisonDeviceFilterOptions().map(option => option.label)).toEqual([
      'Garmin Edge 3130',
      'Polar Vantage',
      'Suunto Race',
      'Wahoo ELEMNT',
    ]);
    expect(component.comparisonActivityTypeFilterOptions().map(option => option.label)).toEqual([
      'Cycling',
      'Running',
    ]);

    component.updateComparisonFilter('');
    component.updateComparisonDeviceFilter('Suunto Race');
    expect(component.filteredComparisonItems().map(item => item.id)).toEqual(['long-course']);

    component.updateComparisonDeviceFilter('');
    component.updateComparisonActivityTypeFilter('Running');
    expect(component.filteredComparisonItems().map(item => item.id)).toEqual(['short-course']);
  });

  it('shows sortable benchmark GNSS, heart-rate, and altitude metrics with old-report fallbacks', () => {
    userSubject.next(new User('user-1'));
    component.comparisons.set([
      makeComparisonEvent('latest-report-metrics', {
        title: 'Latest report metrics',
        startDate: new Date('2026-01-03T00:00:00.000Z'),
        benchmarkResults: {
          older: makeBenchmarkResult({
            referenceName: 'Old Reference',
            testName: 'Old Test',
            timestamp: new Date('2026-01-01T00:00:00.000Z'),
            metrics: {
              gnss: {
                meanDeviation: 99,
                meanAbsoluteError: 99,
                cep50: 99,
                cep95: 99,
                maxDeviation: 99,
                rmse: 99,
                totalDistanceDifference: 99,
              },
              streamMetrics: {
                [DataHeartRate.type]: {
                  sourceA_mean: 120,
                  sourceB_mean: 140,
                  meanDeviation: 20,
                  pearsonCorrelation: 1,
                  meanAbsoluteError: 20,
                  rootMeanSquareError: 20,
                },
              },
            },
          }),
          latest: makeBenchmarkResult({
            referenceName: 'Garmin Forerunner 965',
            testName: 'Suunto Race',
            timestamp: new Date('2026-01-02T00:00:00.000Z'),
            metrics: {
              gnss: {
                meanDeviation: 2.4,
                meanAbsoluteError: 2.4,
                cep50: 1.8,
                cep95: 4,
                maxDeviation: 7,
                rmse: 3.3,
                totalDistanceDifference: 12,
              },
              streamMetrics: {
                HeartRate: {
                  sourceA_mean: 150,
                  sourceB_mean: 148,
                  meanDeviation: -2,
                  pearsonCorrelation: 0.98,
                  meanAbsoluteError: 4.2,
                  rootMeanSquareError: 5,
                },
                [DataAltitude.type]: {
                  sourceA_mean: 100,
                  sourceB_mean: 106.5,
                  meanDeviation: 6.5,
                  pearsonCorrelation: 0.97,
                  meanAbsoluteError: 8.4,
                  rootMeanSquareError: 9,
                },
              },
            },
          }),
        },
      }),
      makeComparisonEvent('old-stream-metrics', {
        title: 'Old stream metrics',
        startDate: new Date('2026-01-02T00:00:00.000Z'),
        benchmarkResults: {
          old: makeBenchmarkResult({
            timestamp: new Date('2026-01-01T00:00:00.000Z'),
            metrics: {
              gnss: {
                cep50: 5,
                cep95: 8,
                maxDeviation: 12,
                rmse: 7,
                totalDistanceDifference: 20,
              },
              streamMetrics: {
                [DataHeartRate.type]: {
                  sourceA_mean: 120,
                  sourceB_mean: 123,
                  pearsonCorrelation: 0.98,
                  meanAbsoluteError: 5,
                  rootMeanSquareError: 6,
                },
                [DataAltitude.type]: {
                  sourceA_mean: 100,
                  sourceB_mean: 95,
                  pearsonCorrelation: 0.95,
                  meanAbsoluteError: 6,
                  rootMeanSquareError: 7,
                },
              },
            },
          }),
        },
      }),
      makeComparisonEvent('draft-no-report', {
        title: 'Draft no report',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ]);
    fixture.detectChanges();

    const latest = component.comparisonItems().find(item => item.id === 'latest-report-metrics');
    expect(latest?.gnssBenchmark.lines.map(line => `${line.label} ${line.value}`)).toEqual([
      'MD 2.4 m',
      'MAE 2.4 m',
      'CEP50 1.8 m',
      'RMSE 3.3 m',
    ]);
    expect(latest?.heartRateBenchmark.lines.map(line => `${line.label} ${line.value}`)).toEqual([
      'MD -2 bpm',
      'MAE 4 bpm',
    ]);
    expect(latest?.altitudeBenchmark.lines.map(line => `${line.label} ${line.value}`)).toEqual([
      'MD +6.5 m',
      'MAE 8.4 m',
    ]);
    expect(latest?.gnssBenchmark.color).toBe(AppColors.Orange);
    expect(latest?.gnssBenchmark.severityLabel).toBe('moderate error');
    expect(latest?.gnssBenchmark.dominantLineLabel).toBe('MAE');
    expect(latest?.gnssBenchmark.canRerunReport).toBe(false);
    expect(latest?.heartRateBenchmark.color).toBe(AppColors.Orange);
    expect(latest?.altitudeBenchmark.color).toBe(AppColors.Red);
    expect(latest?.altitudeBenchmark.severityLabel).toBe('high error');
    expect(latest?.benchmarkPairLabel).toBe('Garmin Forerunner 965 -> Suunto Race');
    expect(latest?.reportTitle).toContain('Benchmark pair: Garmin Forerunner 965 -> Suunto Race.');
    expect(latest?.gnssBenchmark.title).toContain('Showing latest of 2 reports.');
    expect(latest?.gnssBenchmark.title).toContain('Benchmark pair: Garmin Forerunner 965 -> Suunto Race.');
    expect(latest?.gnssBenchmark.title).toContain('Color: moderate error (MAE 2.4 m; green <=2, orange <=5, red >5).');

    const old = component.comparisonItems().find(item => item.id === 'old-stream-metrics');
    expect(old?.gnssBenchmark.lines.map(line => `${line.label} ${line.value}`)).toEqual([
      'MD -',
      'MAE -',
      'CEP50 5 m',
      'RMSE 7 m',
    ]);
    expect(old?.gnssBenchmark.sortValue).toBe(5);
    expect(old?.gnssBenchmark.color).toBe(AppColors.Orange);
    expect(old?.gnssBenchmark.dominantLineLabel).toBe('CEP50');
    expect(old?.gnssBenchmark.title).toContain('MD/MAE are unavailable for older GNSS reports');
    expect(old?.gnssBenchmark.canRerunReport).toBe(true);
    expect(old?.heartRateBenchmark.lines.map(line => `${line.label} ${line.value}`)).toEqual([
      'MD +3 bpm',
      'MAE 5 bpm',
    ]);
    expect(old?.altitudeBenchmark.lines.map(line => `${line.label} ${line.value}`)).toEqual([
      'MD -5 m',
      'MAE 6 m',
    ]);
    expect(old?.heartRateBenchmark.color).toBe(AppColors.Orange);
    expect(old?.altitudeBenchmark.color).toBe(AppColors.Red);

    const draft = component.comparisonItems().find(item => item.id === 'draft-no-report');
    expect(draft?.gnssBenchmark.color).toBeNull();
    expect(draft?.gnssBenchmark.severityLabel).toBe('missing');
    expect(draft?.gnssBenchmark.title).toBe(
      'No benchmark report yet. Run the benchmark report from this row to generate GNSS, heart-rate, and altitude metrics.',
    );
    expect(draft?.heartRateBenchmark.title).toBe(draft?.gnssBenchmark.title);
    expect(draft?.altitudeBenchmark.title).toBe(draft?.gnssBenchmark.title);

    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('GNSS');
    expect(text).toContain('HR');
    expect(text).toContain('Alt');
    expect(text).toContain('CEP50');
    expect(text).toContain('Rerun');
    expect(text).toContain('+6.5 m');
    expect(text).toContain('Garmin Forerunner 965 -> Suunto Race');
    const renderedGnssCells = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.mat-column-gnss .benchmark-summary-stack'));
    expect(renderedGnssCells.map(cell => cell.getAttribute('data-severity'))).toEqual([
      'moderate error',
      'moderate error',
      'missing',
    ]);

    component.onComparisonSortChange({ active: 'heartRate', direction: 'asc' });
    expect(component.sortedComparisonItems().map(item => item.id)).toEqual([
      'latest-report-metrics',
      'old-stream-metrics',
      'draft-no-report',
    ]);
    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('sort', {
      sortColumn: 'heartRate',
      sortDirection: 'asc',
      filterActive: false,
      resultCount: 3,
    });

    component.onComparisonSortChange({ active: 'gnss', direction: 'asc' });
    expect(component.sortedComparisonItems().map(item => item.id)).toEqual([
      'latest-report-metrics',
      'old-stream-metrics',
      'draft-no-report',
    ]);

    component.updateComparisonFilter('mae');
    expect(component.filteredComparisonItems().map(item => item.id)).toEqual([
      'latest-report-metrics',
      'old-stream-metrics',
    ]);
  });

  it('opens the device color editor from the page header and device dot', () => {
    const user = new User('user-1');
    eventColorServiceMock.getActivityColor.mockImplementation((_activities, activity) =>
      activity?.getID?.() === 'activity-1' ? '#FF00FF' : '#16B4EA',
    );
    component.authResolved.set(true);
    component.firebaseSignedIn.set(true);
    component.currentUser.set(user);
    component.comparisons.set([
      makeComparisonEvent('long-course', {
        title: 'Long course',
        activities: [
          makeActivity('activity-1', {
            deviceName: 'Garmin Edge',
            swInfo: '3129',
            activityType: 'Cycling',
          }),
        ],
      }),
    ]);
    const dialogOpenSpy = vi.spyOn((component as any).dialog, 'open').mockReturnValue({ afterClosed: () => of(false) } as any);
    fixture.detectChanges();

    const colorButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find(button => button.textContent?.includes('Device colors')) as HTMLButtonElement | undefined;
    expect(colorButton?.disabled).toBe(false);
    expect(colorButton?.closest('.workspace-header-actions')).not.toBeNull();
    expect(colorButton?.closest('.comparison-table-controls')).toBeNull();
    colorButton?.dispatchEvent(new Event('click'));

    expect(dialogOpenSpy).toHaveBeenCalledWith(DeviceColorPreferencesDialogComponent, {
      width: 'min(40rem, calc(100vw - 32px))',
      maxWidth: 'calc(100vw - 32px)',
      data: {
        devices: [
          {
            key: 'garmin edge',
            label: 'Garmin Edge 3129',
            automaticColor: '#123456',
          },
        ],
        initialDeviceKey: null,
      },
    });

    dialogOpenSpy.mockClear();
    const deviceDotButton = (fixture.nativeElement as HTMLElement).querySelector('.device-color-trigger') as HTMLButtonElement;
    deviceDotButton.click();

    expect(dialogOpenSpy).toHaveBeenCalledWith(DeviceColorPreferencesDialogComponent, {
      width: 'min(40rem, calc(100vw - 32px))',
      maxWidth: 'calc(100vw - 32px)',
      data: {
        devices: [
          {
            key: 'garmin edge',
            label: 'Garmin Edge 3129',
            automaticColor: '#123456',
          },
        ],
        initialDeviceKey: 'garmin edge',
      },
    });
    expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(2);
  });

  it('filters loaded comparisons by review tags and saves row tag edits', async () => {
    const user = new User('user-1');
    const firmwareEvent = makeComparisonEvent('firmware-comparison', {
      title: 'Firmware comparison',
      benchmarkReviewTags: ['Firmware'],
    });
    const routeEvent = makeComparisonEvent('route-comparison', {
      title: 'Route comparison',
      benchmarkReviewTags: ['Route'],
    });
    const untaggedEvent = makeComparisonEvent('untagged-comparison', {
      title: 'Untagged comparison',
    });
    component.authResolved.set(true);
    component.firebaseSignedIn.set(true);
    component.currentUser.set(user);
    component.comparisons.set([firmwareEvent, routeEvent, untaggedEvent]);
    fixture.detectChanges();

    expect(component.displayedComparisonColumns.indexOf('tags')).toBeLessThan(
      component.displayedComparisonColumns.indexOf('devices'),
    );
    const tagButtonLabels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.tags-summary-button'))
      .map(button => button.textContent?.replace(/\s+/g, ' ').trim() || '');
    expect(tagButtonLabels).toEqual(expect.arrayContaining([
      expect.stringContaining('Firmware'),
      expect.stringContaining('Route'),
      expect.stringContaining('Add tags'),
    ]));

    expect(component.comparisonTagFilterOptions()).toEqual([
      { value: 'Firmware', label: 'Firmware' },
      { value: 'Route', label: 'Route' },
    ]);

    component.updateComparisonTagFilter('Firmware');
    expect(component.filteredComparisonItems().map(item => item.id)).toEqual(['firmware-comparison']);

    component.updateComparisonTagFilter('');
    component.onComparisonSortChange({ active: 'tags', direction: 'desc' });
    expect(component.sortedComparisonItems().map(item => item.id)).toEqual([
      'route-comparison',
      'firmware-comparison',
      'untagged-comparison',
    ]);

    let dialogData: any;
    const afterClosed$ = new Subject<string[] | null>();
    const dialogOpenSpy = vi.spyOn((component as any).dialog, 'open').mockImplementationOnce((_component, config) => {
      dialogData = config.data;
      return { afterClosed: () => afterClosed$ } as any;
    });

    const editPromise = component.openBenchmarkReviewTagsDialog(component.comparisonItems()[0]);
    const savedTags = await dialogData.save([' review ']);
    afterClosed$.next(savedTags);
    afterClosed$.complete();
    await editPromise;

    expect(dialogOpenSpy).toHaveBeenCalledWith(BenchmarkReviewTagsDialogComponent, expect.objectContaining({
      width: 'min(34rem, calc(100vw - 32px))',
      data: expect.objectContaining({
        title: 'Comparison tags',
        tags: ['Firmware'],
        suggestions: ['Firmware', 'Route'],
      }),
    }));
    expect(benchmarkReviewServiceMock.saveEventTags).toHaveBeenCalledWith(user, firmwareEvent, [' review ']);
    expect(firmwareEvent.benchmarkReviewTags).toEqual(['review']);
    expect(component.comparisonItems()[0].benchmarkReviewTags).toEqual(['review']);
    expect(hapticsServiceMock.success).toHaveBeenCalled();
    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('tags_save', {
      hasReport: false,
      reportCount: 0,
      filterActive: false,
      resultCount: 3,
      status: 'success',
      tagCount: 1,
    });
  });

  it('renders dashboard-style icons in previous comparison table headers', () => {
    const user = new User('user-1');
    component.authResolved.set(true);
    component.firebaseSignedIn.set(true);
    component.currentUser.set(user);
    component.comparisons.set([
      makeComparisonEvent('header-icons', {
        title: 'Header icons',
        sourceFilesCount: 2,
        activities: [
          makeActivity('activity-1', {
            deviceName: 'Garmin Edge',
            activityType: 'Cycling',
          }),
          makeActivity('activity-2', {
            deviceName: 'Suunto Race',
            activityType: 'Cycling',
          }),
        ],
      }),
    ]);

    fixture.detectChanges();

    const headerLabels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('th .comparison-header-label'));
    const headerTexts = headerLabels.map(header => header.textContent?.replace(/\s+/g, ' ').trim() || '');
    expect(headerTexts).toEqual(expect.arrayContaining([
      expect.stringContaining('Date'),
      expect.stringContaining('Title'),
      expect.stringContaining('Devices'),
      expect.stringContaining('Type'),
      expect.stringContaining('Distance'),
      expect.stringContaining('Ascent'),
      expect.stringContaining('Descent'),
      expect.stringContaining('GNSS'),
      expect.stringContaining('HR'),
      expect.stringContaining('Alt'),
      expect.stringContaining('Description'),
      expect.stringContaining('Tags'),
      expect.stringContaining('Files'),
      expect.stringContaining('Status'),
      expect.stringContaining('Reports'),
      expect.stringContaining('Actions'),
    ]));

    const headerIcons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('th .comparison-header-label mat-icon'))
      .map(icon => icon.textContent?.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    expect(headerIcons).toEqual(expect.arrayContaining([
      'date_range',
      'badge',
      'watch',
      'filter_none',
      'route',
      'elevation',
      'satellite_alt',
      'ecg_heart',
      'landscape',
      'font_download',
      'sell',
      'attach_file',
      'task_alt',
      'analytics',
      'more_horiz',
    ]));
  });

  it('resolves per-device sport types from activity stats and raw activity type aliases', () => {
    const user = new User('user-1');
    userSubject.next(user);
    const cyclingActivityTypes = new DataActivityTypes([ActivityTypes.Cycling]);

    component.comparisons.set([
      makeComparisonEvent('mixed-source-types', {
        title: 'Mixed source types',
        activities: [
          {
            getID: () => 'activity-stat-type',
            creator: {
              name: 'Garmin Edge',
            },
            getStat: (type: string) => type === DataActivityTypes.type ? cyclingActivityTypes : null,
          },
          {
            getID: () => 'activity-raw-type',
            creator: {
              name: 'Suunto Race',
            },
            type: 'running_road',
            getStat: () => null,
          },
        ],
      }),
    ]);
    fixture.detectChanges();

    const item = component.comparisonItems()[0];
    expect(item.activityTypesLabel).toBe('Cycling, Running');
    expect(item.activitySummaries.map(summary => ({
      deviceLabel: summary.deviceLabel,
      activityTypeLabel: summary.activityTypeLabel,
    }))).toEqual([
      { deviceLabel: 'Garmin Edge', activityTypeLabel: 'Cycling' },
      { deviceLabel: 'Suunto Race', activityTypeLabel: 'Running' },
    ]);

    const sportTypeLines = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.summary-type-line'))
      .map(line => line.querySelector('.summary-type-value')?.textContent?.trim());
    expect((fixture.nativeElement as HTMLElement).querySelector('.summary-type-device')).toBeNull();
    expect(sportTypeLines).toContain('Cycling');
    expect(sportTypeLines).toContain('Running');
    expect(item.activityTypesTitle).toBe('Cycling\nRunning');
  });

  it('hydrates previous comparison report rows cache-first when activity summaries are missing', async () => {
    const user = new User('user-1');
    const activity = {
      getID: () => 'activity-1',
      creator: {
        name: 'Garmin Edge Mtb',
        swInfo: '3130',
      },
    };
    eventServiceMock.getActivitiesOnceByEventsWithOptions.mockReturnValueOnce(of(new Map([
      ['comparison-1', [activity]],
    ])));

    userSubject.next(user);
    await Promise.resolve();
    await Promise.resolve();
    component.comparisons.set([
      makeComparisonEvent('comparison-1', {
        title: 'Activity-backed devices',
        benchmarkDevices: ['garmin edge mtb'],
        benchmarkResults: {
          pair: {
            referenceName: 'Garmin Edge Mtb',
            testName: 'Suunto Race',
          },
        },
      }),
    ]);
    fixture.detectChanges();

    await Promise.resolve();
    await Promise.resolve();

    expect(eventServiceMock.getActivitiesOnceByEventsWithOptions).toHaveBeenCalledWith(
      user,
      ['comparison-1'],
      { preferCache: true, warmServer: false },
    );
    expect(eventServiceMock.getActivitiesOnceByEventWithOptions).not.toHaveBeenCalled();
    expect(component.comparisonItems()[0].devicesLabel).toContain('Garmin Edge Mtb 3130');
    expect(component.comparisonItems()[0].activitySummaries[0].deviceLabel).toBe('Garmin Edge Mtb 3130');
  });

  it('does not hydrate draft rows that already have event-level device metadata', async () => {
    const user = new User('user-1');

    userSubject.next(user);
    await Promise.resolve();
    await Promise.resolve();
    component.comparisons.set([
      makeComparisonEvent('comparison-1', {
        title: 'Draft with metadata devices',
        benchmarkDevices: ['garmin edge mtb'],
      }),
    ]);
    fixture.detectChanges();

    await Promise.resolve();
    await Promise.resolve();

    expect(eventServiceMock.getActivitiesOnceByEventsWithOptions).not.toHaveBeenCalled();
    expect(component.comparisonItems()[0].devicesLabel).toBe('Garmin Edge Mtb');
  });

  it('does not repeatedly retry previous comparison activity summary hydration after a failed activity read', async () => {
    const user = new User('user-1');
    const readError = new Error('activity read failed');
    eventServiceMock.getActivitiesOnceByEventsWithOptions.mockImplementation(() => {
      throw readError;
    });

    userSubject.next(user);
    await Promise.resolve();
    await Promise.resolve();
    component.comparisons.set([
      makeComparisonEvent('comparison-1', {
        title: 'Activity-backed devices',
      }),
    ]);
    fixture.detectChanges();

    await Promise.resolve();
    await Promise.resolve();

    component.updateComparisonFilter('activity');
    fixture.detectChanges();
    await Promise.resolve();
    component.updateComparisonFilter('');
    fixture.detectChanges();
    await Promise.resolve();

    expect(eventServiceMock.getActivitiesOnceByEventsWithOptions).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[ToolsComparePageComponent] Could not hydrate comparison activity summaries.',
      { eventIDs: ['comparison-1'], error: readError },
    );
  });

  it('batches visible activity summary hydration reads without duplicate pending requests', async () => {
    const user = new User('user-1');
    const activitiesByEvent$ = new Subject<Map<string, unknown[]>>();
    eventServiceMock.getActivitiesOnceByEventsWithOptions.mockReturnValueOnce(activitiesByEvent$);

    userSubject.next(user);
    await Promise.resolve();
    await Promise.resolve();
    component.comparisons.set([
      makeComparisonEvent('comparison-1', {
        title: 'First activity-backed devices',
      }),
      makeComparisonEvent('comparison-2', {
        title: 'Second activity-backed devices',
      }),
    ]);
    fixture.detectChanges();
    await Promise.resolve();

    expect(eventServiceMock.getActivitiesOnceByEventsWithOptions).toHaveBeenCalledTimes(1);
    expect(eventServiceMock.getActivitiesOnceByEventsWithOptions).toHaveBeenCalledWith(
      user,
      ['comparison-1', 'comparison-2'],
      { preferCache: true, warmServer: false },
    );

    component.updateComparisonFilter('activity');
    fixture.detectChanges();
    await Promise.resolve();

    expect(eventServiceMock.getActivitiesOnceByEventsWithOptions).toHaveBeenCalledTimes(1);

    activitiesByEvent$.next(new Map());
    activitiesByEvent$.complete();
    await Promise.resolve();
    expect(eventServiceMock.getActivitiesOnceByEventsWithOptions).toHaveBeenCalledTimes(1);
  });

  it('renders previous comparison descriptions as compact text until editing', () => {
    userSubject.next(new User('user-1'));
    component.comparisons.set([
      makeComparisonEvent('comparison-1', {
        title: 'Comparison',
        description: 'Original note',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.description-display')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.description-editor')).toBeNull();
    expect(fixture.nativeElement.querySelector('.description-display mat-icon')).toBeNull();

    const editButton = fixture.nativeElement.querySelector(
      'button[aria-label="Edit comparison description"]',
    ) as HTMLButtonElement;
    expect(editButton.textContent).toContain('Original note');
    editButton.click();
    fixture.detectChanges();

    expect(component.editingDescriptionEventID()).toBe('comparison-1');
    expect(fixture.nativeElement.querySelector('.description-display')).toBeNull();
    expect(fixture.nativeElement.querySelector('.description-editor')).not.toBeNull();
    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('description_edit', {
      hasReport: false,
      reportCount: 0,
      filterActive: false,
      resultCount: 1,
      hadDescription: true,
    });
  });

  it('renders missing comparison descriptions as an add note button', () => {
    userSubject.next(new User('user-1'));
    component.comparisons.set([
      makeComparisonEvent('comparison-1', {
        title: 'Comparison',
        description: '',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ]);
    fixture.detectChanges();

    const addButton = fixture.nativeElement.querySelector(
      'button[aria-label="Add comparison description"]',
    ) as HTMLButtonElement;

    expect(addButton.textContent?.trim()).toBe('Add note');
    expect(addButton.querySelector('mat-icon')).toBeNull();
  });

  it('saves previous comparison descriptions inline', async () => {
    const user = new User('user-1');
    userSubject.next(user);
    await Promise.resolve();
    await Promise.resolve();
    const event = makeComparisonEvent('comparison-1', {
      title: 'Comparison',
      description: 'Original note',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    });
    component.comparisons.set([event]);
    const item = component.comparisonItems()[0];

    component.updateDescriptionDraft(item, 'Updated note');
    await component.saveDescription(component.comparisonItems()[0]);

    expect(eventServiceMock.updateEventProperties).toHaveBeenCalledWith(user, 'comparison-1', {
      description: 'Updated note',
    });
    expect(event.description).toBe('Updated note');
    expect(component.descriptionDrafts()).toEqual({});
    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('description_save', {
      hasReport: false,
      reportCount: 0,
      filterActive: false,
      resultCount: 1,
      status: 'success',
      hadDescription: true,
    });
    expect(hapticsServiceMock.success).toHaveBeenCalled();
  });

  it('keeps comparison row data stable while editing description drafts', () => {
    component.comparisons.set([
      makeComparisonEvent('comparison-1', {
        title: 'Comparison',
        description: 'Original note',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ]);
    const itemBeforeDraft = component.comparisonItems()[0];

    component.updateDescriptionDraft(itemBeforeDraft, 'Draft note');

    expect(component.comparisonItems()[0]).toBe(itemBeforeDraft);
    expect(component.descriptionDrafts()).toEqual({ 'comparison-1': 'Draft note' });
  });

  it('does not save unchanged previous comparison descriptions', async () => {
    userSubject.next(new User('user-1'));
    component.comparisons.set([
      makeComparisonEvent('comparison-1', {
        title: 'Comparison',
        description: 'Original note',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ]);

    await component.saveDescription(component.comparisonItems()[0]);

    expect(eventServiceMock.updateEventProperties).not.toHaveBeenCalled();
  });

  it('reverts previous comparison description drafts when saving fails', async () => {
    userSubject.next(new User('user-1'));
    eventServiceMock.updateEventProperties.mockRejectedValueOnce(new Error('write failed'));
    const event = makeComparisonEvent('comparison-1', {
      title: 'Comparison',
      description: 'Original note',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    });
    component.comparisons.set([event]);

    component.updateDescriptionDraft(component.comparisonItems()[0], 'Failed note');
    await component.saveDescription(component.comparisonItems()[0]);

    expect(event.description).toBe('Original note');
    expect(component.descriptionDrafts()).toEqual({});
    expect(hapticsServiceMock.error).toHaveBeenCalled();
  });

  it('resets pagination after deleting a comparison from a later page', async () => {
    const user = new User('user-1');
    userSubject.next(user);
    await Promise.resolve();
    await Promise.resolve();
    (component as any).dialog = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of(true),
      }),
    };
    component.comparisons.set([
      makeComparisonEvent('comparison-1'),
      makeComparisonEvent('comparison-2'),
      makeComparisonEvent('comparison-3'),
    ]);
    component.comparisonPage.set({ pageIndex: 0, pageSize: 2 });
    await component.onComparisonPageChange({ pageIndex: 1, pageSize: 2, length: 3, previousPageIndex: 0 });

    await component.deleteComparison(component.comparisonItems()[2]);

    expect(eventServiceMock.deleteAllEventData).toHaveBeenCalledWith(user, 'comparison-3');
    expect(component.comparisonPage().pageIndex).toBe(0);
    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('delete', {
      hasReport: false,
      reportCount: 0,
      filterActive: false,
      resultCount: 3,
      status: 'confirmed',
    });
    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('delete', {
      hasReport: false,
      reportCount: 0,
      filterActive: false,
      resultCount: 2,
      status: 'success',
    });
    expect(hapticsServiceMock.success).toHaveBeenCalled();
  });

  it('uses source file metadata count fallbacks instead of showing fake zeroes for saved benchmarks', () => {
    component.comparisons.set([
      {
        getID: () => 'with-original-files',
        name: 'Original files',
        startDate: new Date('2026-01-03T00:00:00.000Z'),
        originalFiles: [
          { path: 'users/user-1/events/event-1/one.fit', startDate: new Date(), originalFilename: 'reference.fit' },
          { path: 'users/user-1/events/event-1/test-route.tcx', startDate: new Date() },
        ],
        getActivities: () => [{ getID: () => 'activity-1' }],
      } as any,
      {
        getID: () => 'unknown-counts',
        name: 'Unknown counts',
        startDate: new Date('2026-01-04T00:00:00.000Z'),
        getActivities: () => [],
      } as any,
    ]);

    expect(component.comparisonItems()[0]).toEqual(expect.objectContaining({
      sourceFilesCount: 2,
      sourceFilesLabel: '2 files',
      sourceFilesTitle: 'reference.fit\ntest-route.tcx',
    }));
    expect(component.comparisonItems()[1]).toEqual(expect.objectContaining({
      sourceFilesCount: null,
      sourceFilesLabel: 'Files unknown',
      sourceFilesTitle: 'Files unknown',
    }));

    component.onComparisonSortChange({ active: 'sourceFiles', direction: 'asc' });
    expect(component.sortedComparisonItems().map(item => item.id)).toEqual(['with-original-files', 'unknown-counts']);
  });

  it('shows original comparison filenames in the files cell tooltip', () => {
    component.authResolved.set(true);
    component.firebaseSignedIn.set(true);
    component.currentUser.set(new User('user-1'));
    component.comparisons.set([
      makeComparisonEvent('files-tooltip', {
        title: 'Files tooltip',
        sourceFilesCount: 2,
        originalFiles: [
          { path: 'users/user-1/events/event-1/uploaded-a.fit', startDate: new Date(), originalFilename: 'Garmin Edge.fit' },
          { path: 'users/user-1/events/event-1/Suunto%20Vertical.gpx', startDate: new Date() },
        ],
      }),
    ]);
    fixture.detectChanges();

    const filesCell = (fixture.nativeElement as HTMLElement).querySelector('.source-files-cell') as HTMLElement;

    expect(filesCell?.textContent?.trim()).toBe('2 files');
    expect(filesCell?.getAttribute('title')).toBe('Garmin Edge.fit\nSuunto Vertical.gpx');
  });
});
