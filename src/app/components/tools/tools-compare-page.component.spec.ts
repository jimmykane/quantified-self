import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes, DataActivityTypes, DataAscent, DataDescent, DataDistance, User } from '@sports-alliance/sports-lib';
import { AppEventInterface } from '@shared/app-event.interface';

import { AppAuthService } from '../../authentication/app.auth.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppEventService } from '../../services/app.event.service';
import { AppToolsComparisonService } from '../../services/app.tools-comparison.service';
import { LoggerService } from '../../services/logger.service';
import { ToolsComparePageComponent } from './tools-compare-page.component';
import { AppEventColorService } from '../../services/color/app.event.color.service';

function makeComparisonEvent(id: string, overrides: {
  title?: string;
  description?: string;
  startDate?: Date;
  sourceFilesCount?: number;
  benchmarkResults?: Record<string, unknown>;
  benchmarkDevices?: string[];
  activities?: unknown[];
} = {}): AppEventInterface {
  return {
    getID: () => id,
    name: overrides.title || 'Benchmark comparison',
    description: overrides.description || '',
    startDate: overrides.startDate || new Date('2026-01-01T00:00:00.000Z'),
    sourceFilesCount: overrides.sourceFilesCount,
    benchmarkResults: overrides.benchmarkResults,
    benchmarkDevices: overrides.benchmarkDevices,
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
        { provide: AppEventService, useValue: eventServiceMock },
        { provide: AppEventColorService, useValue: eventColorServiceMock },
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
    expect(text).not.toContain('New comparison');
    expect(text).not.toContain('Saved comparisons');
    expect(text).not.toContain('Select Files');
    expect(text).not.toContain('No files selected');
    expect(text).not.toContain('Sign in to view saved comparisons.');
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
    expect(inputTarget.value).toBe('');
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
    userSubject.next(user);
    await Promise.resolve();
    await Promise.resolve();
    component.comparisons.set([
      makeComparisonEvent('ready-comparison', {
        title: 'Private title',
        description: 'Private note',
        benchmarkResults: { 'a_b': { score: 90 } },
      }),
      makeComparisonEvent('draft-comparison', {
        title: 'Draft title',
      }),
    ]);

    await component.openComparison(component.comparisonItems()[0], false);
    await component.openComparison(component.comparisonItems()[1], true);

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
    expect(routerNavigateSpy).toHaveBeenCalledWith(['/user', 'user-1', 'event', 'ready-comparison'], {
      queryParams: undefined,
    });
    expect(routerNavigateSpy).toHaveBeenCalledWith(['/user', 'user-1', 'event', 'draft-comparison'], {
      queryParams: { benchmark: '1' },
    });
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
    expect(component.comparisonPage().pageIndex).toBe(0);
    expect(analyticsServiceMock.logToolCompareSavedAction).toHaveBeenCalledWith('filter', {
      status: 'applied',
      filterActive: true,
      resultCount: 1,
    });
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
      distanceLabel: summary.distanceLabel,
      ascentLabel: summary.ascentLabel,
      descentLabel: summary.descentLabel,
    }))).toEqual([
      {
        deviceLabel: 'Garmin Edge 3130',
        deviceColor: '#123456',
        activityTypeLabel: 'Cycling',
        distanceLabel: '10.00 km',
        ascentLabel: '120 m',
        descentLabel: '118 m',
      },
      {
        deviceLabel: 'Suunto Race',
        deviceColor: '#abcdef',
        activityTypeLabel: 'Cycling',
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
      .map(line => line.textContent?.trim());
    expect((fixture.nativeElement as HTMLElement).querySelector('.summary-type-device')).toBeNull();
    expect(sportTypeLines).toContain('Cycling');
    expect(sportTypeLines).toContain('Running');
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
      .map(line => line.textContent?.trim());
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
  });

  it('uses source file metadata count fallbacks instead of showing fake zeroes for saved benchmarks', () => {
    component.comparisons.set([
      {
        getID: () => 'with-original-files',
        name: 'Original files',
        startDate: new Date('2026-01-03T00:00:00.000Z'),
        originalFiles: [{ path: 'one.fit', startDate: new Date() }],
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
      sourceFilesCount: 1,
      sourceFilesLabel: '1 file',
    }));
    expect(component.comparisonItems()[1]).toEqual(expect.objectContaining({
      sourceFilesCount: null,
      sourceFilesLabel: 'Files unknown',
    }));

    component.onComparisonSortChange({ active: 'sourceFiles', direction: 'asc' });
    expect(component.sortedComparisonItems().map(item => item.id)).toEqual(['with-original-files', 'unknown-counts']);
  });
});
