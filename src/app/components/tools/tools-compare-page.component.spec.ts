import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { User } from '@sports-alliance/sports-lib';

import { AppAuthService } from '../../authentication/app.auth.service';
import { AppEventService } from '../../services/app.event.service';
import { AppToolsComparisonService } from '../../services/app.tools-comparison.service';
import { ToolsComparePageComponent } from './tools-compare-page.component';

describe('ToolsComparePageComponent', () => {
  let fixture: ComponentFixture<ToolsComparePageComponent>;
  let component: ToolsComparePageComponent;
  let userSubject: BehaviorSubject<User | null>;
  let routerNavigateSpy: ReturnType<typeof vi.spyOn>;
  let comparisonServiceMock: {
    validateFiles: ReturnType<typeof vi.fn>;
    createComparison: ReturnType<typeof vi.fn>;
    getBenchmarkComparisons: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    userSubject = new BehaviorSubject<User | null>(null);
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

    await TestBed.configureTestingModule({
      imports: [ToolsComparePageComponent, RouterTestingModule.withRoutes([]), NoopAnimationsModule],
      providers: [
        {
          provide: AppAuthService,
          useValue: {
            user$: userSubject.asObservable(),
            redirectUrl: '',
          },
        },
        { provide: AppToolsComparisonService, useValue: comparisonServiceMock },
        { provide: AppEventService, useValue: { deleteAllEventData: vi.fn().mockResolvedValue(true) } },
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
    expect(text).toContain('Sign in to create and save comparisons.');
    expect(comparisonServiceMock.getBenchmarkComparisons).not.toHaveBeenCalled();
  });

  it('loads saved benchmark comparisons for signed-in users', () => {
    const user = new User('user-1');
    userSubject.next(user);
    fixture.detectChanges();

    expect(comparisonServiceMock.getBenchmarkComparisons).toHaveBeenCalledWith(user);
  });

  it('clears the saved comparisons loading state after a live query emission', () => {
    const liveComparisons$ = new Subject<any[]>();
    comparisonServiceMock.getBenchmarkComparisons.mockReturnValue(liveComparisons$);

    userSubject.next(new User('user-1'));
    expect(component.isLoadingComparisons()).toBe(true);

    liveComparisons$.next([]);

    expect(component.isLoadingComparisons()).toBe(false);
  });

  it('sends guests to login when they try to create a comparison', async () => {
    await component.createComparison();

    expect(routerNavigateSpy).toHaveBeenCalledWith(['/login']);
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
