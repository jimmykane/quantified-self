import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { User } from '@sports-alliance/sports-lib';
import { AppEventInterface } from '@shared/app-event.interface';

import { AppAuthService } from '../../authentication/app.auth.service';
import { AppEventService } from '../../services/app.event.service';
import { AppToolsComparisonService } from '../../services/app.tools-comparison.service';
import { LoggerService } from '../../services/logger.service';
import { ToolsComparePageComponent } from './tools-compare-page.component';

function makeComparisonEvent(id: string, overrides: {
  title?: string;
  description?: string;
  startDate?: Date;
  sourceFilesCount?: number;
  activitiesCount?: number;
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
    activitiesCount: overrides.activitiesCount,
    benchmarkResults: overrides.benchmarkResults,
    benchmarkDevices: overrides.benchmarkDevices,
    getActivities: () => overrides.activities || [],
  } as unknown as AppEventInterface;
}

describe('ToolsComparePageComponent', () => {
  let fixture: ComponentFixture<ToolsComparePageComponent>;
  let component: ToolsComparePageComponent;
  let userSubject: BehaviorSubject<User | null>;
  let routerNavigateSpy: ReturnType<typeof vi.spyOn>;
  let eventServiceMock: {
    deleteAllEventData: ReturnType<typeof vi.fn>;
    getActivitiesOnceByEvent: ReturnType<typeof vi.fn>;
    updateEventProperties: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    user$: ReturnType<BehaviorSubject<User | null>['asObservable']>;
    redirectUrl: string | null;
  };
  let comparisonServiceMock: {
    validateFiles: ReturnType<typeof vi.fn>;
    createComparison: ReturnType<typeof vi.fn>;
    getBenchmarkComparisons: ReturnType<typeof vi.fn>;
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
      getBenchmarkComparisons: vi.fn().mockReturnValue(of([])),
    };
    eventServiceMock = {
      deleteAllEventData: vi.fn().mockResolvedValue(true),
      getActivitiesOnceByEvent: vi.fn().mockReturnValue(of([])),
      updateEventProperties: vi.fn().mockResolvedValue(undefined),
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
        { provide: AppEventService, useValue: eventServiceMock },
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
    expect(comparisonServiceMock.getBenchmarkComparisons).not.toHaveBeenCalled();
  });

  it('does not render the signed-in workspace for guests', () => {
    expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Sign in to view saved comparisons.');
  });

  it('loads saved benchmark comparisons for signed-in users', () => {
    const user = new User('user-1');
    userSubject.next(user);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Compare files');
    expect(fixture.nativeElement.textContent).toContain('New comparison');
    expect(fixture.nativeElement.textContent).toContain('Previous comparisons');
    expect(fixture.nativeElement.textContent).not.toContain('Create one saved benchmark event from multiple source files');
    expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(comparisonServiceMock.getBenchmarkComparisons).toHaveBeenCalledWith(user);
  });

  it('renders previous comparisons before upload controls when the saved route is focused', () => {
    Object.defineProperty(component, 'showSavedComparisonsFirst', {
      configurable: true,
      value: true,
    });
    userSubject.next(new User('user-1'));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text.indexOf('Previous comparisons')).toBeLessThan(text.indexOf('New comparison'));
  });

  it('clears the saved comparisons loading state after a live query emission', () => {
    const liveComparisons$ = new Subject<any[]>();
    comparisonServiceMock.getBenchmarkComparisons.mockReturnValue(liveComparisons$);

    userSubject.next(new User('user-1'));
    expect(component.isLoadingComparisons()).toBe(true);

    liveComparisons$.next([]);

    expect(component.isLoadingComparisons()).toBe(false);
  });

  it('logs saved comparison load errors so missing-index URLs are visible', () => {
    const missingIndexError = {
      code: 'failed-precondition',
      message: 'The query requires an index. Create it here: https://console.firebase.google.com/index-url',
    };
    comparisonServiceMock.getBenchmarkComparisons.mockReturnValue(throwError(() => missingIndexError));

    userSubject.next(new User('user-1'));

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
    expect(routerNavigateSpy).toHaveBeenCalledWith(['/user', 'user-1', 'event', 'event-1'], {
      queryParams: { benchmark: '1' },
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

  it('filters, sorts, and paginates previous comparison rows', () => {
    component.comparisons.set([
      makeComparisonEvent('older-draft', {
        title: 'Older draft',
        description: 'Lab test',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        sourceFilesCount: 2,
        activitiesCount: 2,
      }),
      makeComparisonEvent('new-ready', {
        title: 'New ready',
        description: 'Race file',
        startDate: new Date('2026-01-03T00:00:00.000Z'),
        sourceFilesCount: 4,
        activitiesCount: 5,
        benchmarkResults: { 'a_b': { score: 90 } },
      }),
      makeComparisonEvent('middle-ready', {
        title: 'Middle ready',
        description: 'Review file',
        startDate: new Date('2026-01-02T00:00:00.000Z'),
        sourceFilesCount: 3,
        activitiesCount: 4,
        benchmarkResults: { 'c_d': { score: 85 }, 'e_f': { score: 80 } },
      }),
    ]);

    expect(component.sortedComparisonItems().map(item => item.id)).toEqual([
      'new-ready',
      'middle-ready',
      'older-draft',
    ]);

    component.onComparisonSortChange({ active: 'sourceFiles', direction: 'asc' });
    expect(component.sortedComparisonItems().map(item => item.id)).toEqual([
      'older-draft',
      'middle-ready',
      'new-ready',
    ]);

    component.onComparisonPageChange({ pageIndex: 1, pageSize: 1, length: 3, previousPageIndex: 0 });
    expect(component.paginatedComparisonItems().map(item => item.id)).toEqual(['middle-ready']);

    component.updateComparisonFilter('race');
    expect(component.filteredComparisonItems().map(item => item.id)).toEqual(['new-ready']);
    expect(component.comparisonPage().pageIndex).toBe(0);
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

  it('hydrates draft previous comparison devices from linked activities on visible rows', async () => {
    const user = new User('user-1');
    const activity = {
      getID: () => 'activity-1',
      creator: {
        name: 'Garmin Edge Mtb',
        swInfo: '3130',
      },
    };
    eventServiceMock.getActivitiesOnceByEvent.mockReturnValueOnce(of([activity]));

    userSubject.next(user);
    component.comparisons.set([
      makeComparisonEvent('comparison-1', {
        title: 'Activity-backed devices',
        benchmarkDevices: ['garmin edge mtb'],
      }),
    ]);
    fixture.detectChanges();

    await Promise.resolve();
    await Promise.resolve();

    expect(eventServiceMock.getActivitiesOnceByEvent).toHaveBeenCalledWith(user, 'comparison-1');
    expect(component.comparisonItems()[0].devicesLabel).toBe('Garmin Edge Mtb 3130');
  });

  it('does not repeatedly retry previous comparison device hydration after a failed activity read', async () => {
    const user = new User('user-1');
    const readError = new Error('activity read failed');
    eventServiceMock.getActivitiesOnceByEvent.mockImplementation(() => {
      throw readError;
    });

    userSubject.next(user);
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

    expect(eventServiceMock.getActivitiesOnceByEvent).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[ToolsComparePageComponent] Could not hydrate comparison devices.',
      { eventID: 'comparison-1', error: readError },
    );
  });

  it('does not enqueue duplicate device hydration reads while a visible batch is pending', async () => {
    const user = new User('user-1');
    const firstActivities$ = new Subject<unknown[]>();
    const secondActivities$ = new Subject<unknown[]>();
    eventServiceMock.getActivitiesOnceByEvent
      .mockReturnValueOnce(firstActivities$)
      .mockReturnValueOnce(secondActivities$);

    userSubject.next(user);
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

    expect(eventServiceMock.getActivitiesOnceByEvent).toHaveBeenCalledTimes(1);

    component.updateComparisonFilter('activity');
    fixture.detectChanges();
    await Promise.resolve();

    expect(eventServiceMock.getActivitiesOnceByEvent).toHaveBeenCalledTimes(1);

    firstActivities$.next([]);
    firstActivities$.complete();
    await Promise.resolve();

    expect(eventServiceMock.getActivitiesOnceByEvent).toHaveBeenCalledTimes(2);
    expect(eventServiceMock.getActivitiesOnceByEvent).toHaveBeenLastCalledWith(user, 'comparison-2');

    secondActivities$.next([]);
    secondActivities$.complete();
    await Promise.resolve();
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

    const editButton = fixture.nativeElement.querySelector(
      'button[aria-label="Edit comparison description"]',
    ) as HTMLButtonElement;
    editButton.click();
    fixture.detectChanges();

    expect(component.editingDescriptionEventID()).toBe('comparison-1');
    expect(fixture.nativeElement.querySelector('.description-display')).toBeNull();
    expect(fixture.nativeElement.querySelector('.description-editor')).not.toBeNull();
  });

  it('saves previous comparison descriptions inline', async () => {
    const user = new User('user-1');
    userSubject.next(user);
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
    component.onComparisonPageChange({ pageIndex: 1, pageSize: 2, length: 3, previousPageIndex: 0 });

    await component.deleteComparison(component.comparisonItems()[2]);

    expect(eventServiceMock.deleteAllEventData).toHaveBeenCalledWith(user, 'comparison-3');
    expect(component.comparisonPage().pageIndex).toBe(0);
  });

  it('uses source metadata count fallbacks instead of showing fake zeroes for saved benchmarks', () => {
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
      activitiesCount: 1,
      sourceFilesLabel: '1 file',
      activitiesLabel: '1 activity',
    }));
    expect(component.comparisonItems()[1]).toEqual(expect.objectContaining({
      sourceFilesCount: null,
      activitiesCount: null,
      sourceFilesLabel: 'Files unknown',
      activitiesLabel: 'Activities unknown',
    }));
  });
});
