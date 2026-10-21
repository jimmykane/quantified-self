import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { ActivatedRoute, Router, UrlTree, convertToParamMap } from '@angular/router';
import { By } from '@angular/platform-browser';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ActivityTypes, DataActivityTypes, DataDeviceNames, DataDistance, EventImporterJSON, FileType, Privacy, DistanceUnits, User, type EventInterface } from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import type { AppEventInterface } from '@shared/app-event.interface';
import type { AppUserInterface } from '../../models/app-user.interface';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppEventService } from '../../services/app.event.service';
import { EventTagCatalogService } from '../../services/event-tag-catalog.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppUserService } from '../../services/app.user.service';
import { AppEventMergeService } from '../../services/app.event-merge.service';
import { AppEventReprocessService } from '../../services/app.event-reprocess.service';
import { AppEventSharingService } from '../../services/app.event-sharing.service';
import { CalendarDayDetailsNavigationService } from '../../services/calendar-day-details-navigation.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { AppFileService } from '../../services/app.file.service';
import { AppOriginalFileDownloadService } from '../../services/app.original-file-download.service';
import { AppProcessingService } from '../../services/app.processing.service';
import { AppBenchmarkFlowService } from '../../services/app.benchmark-flow.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { EventTagService } from '../../services/event-tag.service';
import { LoggerService } from '../../services/logger.service';
import { AppUserUtilities } from '../../utils/app.user.utilities';
import { EventTableModule } from '../../modules/event-table.module';
import { EventTableComponent, type EventTableEventsChange } from '../event-table/event.table.component';
import { EventTableActionsComponent } from '../event-table/actions/event.table.actions.component';
import { ActivitiesPageComponent } from './activities-page.component';

@Component({ selector: 'app-event-table', standalone: true, template: '<ng-content select="[event-table-filters]"></ng-content><ng-content select="[event-table-active-filters]"></ng-content>' })
class EventTableStub {
  @Input() user: User;
  @Input() events: EventInterface[];
  @Input() showActions: boolean;
  @Input() presentation: string;
  @Input() isLoading: boolean;
  @Input() showTagFilter: boolean;
  @Input() filterContext: string;
  @Input() preserveSearchOnFilterChange: boolean;
  @Input() hideGeneratedNames: boolean;
  @Input() emptyMessage: string;
  @Input() emptyHint: string;
  @Output() eventsChange = new EventEmitter<EventTableEventsChange>();
}

function event(id: string, tags: string[], legacy = false): AppEventInterface {
  return { getID: () => id, startDate: new Date(), getActivityTypesAsArray: () => [id === 'b' ? 'Cycling' : 'Running'], ...(legacy ? { benchmarkReviewTags: tags } : { tags }) } as AppEventInterface;
}
const records = [event('a', ['endurance']), event('b', ['ENDURANCE'], true), event('c', ['Recovery'])];
async function setup(tag = '', realTable = false) {
  const owner = { uid: 'owner' };
  const user = new User('owner') as AppUserInterface;
  if (realTable) user.settings = AppUserUtilities.fillMissingAppSettings(user);
  const user$ = new BehaviorSubject(user);
  const authState$ = new BehaviorSubject(owner);
  const auth = { user$, authState$, currentUser: owner };
  const params$ = new BehaviorSubject(convertToParamMap(tag ? { tag } : {}));
  const events = {
    getEventsBy: vi.fn().mockImplementation(() => of(records.map(record => ({ ...record })))),
    getEventsPageOnceByWithMeta: vi.fn(), getEventCountBy: vi.fn(), getEventCount: vi.fn(),
  };
  const catalog = { listAllTags: vi.fn().mockResolvedValue(['Endurance', 'Race day', 'Recovery']) };
  const haptics = { selection: vi.fn(), error: vi.fn() };
  const userService = { updateUserProperties: vi.fn().mockResolvedValue(undefined) };
  const router = {
    navigate: vi.fn().mockResolvedValue(true), events: new Subject(),
    createUrlTree: vi.fn(() => new UrlTree()), serializeUrl: () => '/mock-event',
  };
  TestBed.configureTestingModule({
    imports: [ActivitiesPageComponent, NoopAnimationsModule, ...(realTable ? [MatIconTestingModule] : [])],
    providers: [
      { provide: AppAuthService, useValue: auth },
      { provide: AppEventService, useValue: events },
      { provide: EventTagCatalogService, useValue: catalog },
      { provide: AppHapticsService, useValue: haptics },
      { provide: ActivatedRoute, useValue: { queryParamMap: params$ } },
      { provide: Router, useValue: router },
      { provide: LoggerService, useValue: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } },
      ...(realTable ? [
        { provide: AppUserService, useValue: userService },
        { provide: AppEventColorService, useValue: { getColorForActivityTypeByActivityTypeGroup: () => '#123456', getGradientForActivityTypeGroup: () => 'none' } },
        ...[AppEventMergeService, AppEventReprocessService, AppEventSharingService, CalendarDayDetailsNavigationService, AppFileService, AppOriginalFileDownloadService,
          AppProcessingService, AppBenchmarkFlowService, AppAnalyticsService, EventTagService]
          .map(provide => ({ provide, useValue: {} })),
      ] : []),
    ],
  });
  if (!realTable) TestBed.overrideComponent(ActivitiesPageComponent, { remove: { imports: [EventTableModule] }, add: { imports: [EventTableStub] } });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(ActivitiesPageComponent);
  return { fixture, component: fixture.componentInstance, auth, user$, authState$, params$, events, catalog, haptics, router, userService };
}
async function render(context: Awaited<ReturnType<typeof setup>>) {
  context.fixture.detectChanges();
  await context.fixture.whenStable();
  await vi.waitFor(() => expect(context.component.loading()).toBe(false));
  context.fixture.detectChanges();
}

describe('ActivitiesPageComponent', () => {
  it('uses Dashboard’s full-range query with bounded numeric dates by default', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 12));
    try {
      const c = await setup();
      const data = records.map(record => ({ ...record, startDate: new Date(2026, 9, 21) }));
      c.events.getEventsBy.mockReturnValue(of(data)); await render(c);
      expect(c.events.getEventsBy).toHaveBeenCalledExactlyOnceWith(c.user$.value, [
        { fieldPath: 'startDate', opStr: '>=', value: new Date(2026, 8, 22).getTime() },
        { fieldPath: 'startDate', opStr: '<', value: new Date(2026, 9, 22).getTime() },
      ], 'startDate', false, 0);
      const table = c.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
      expect(table.events).toEqual(data); expect(table.presentation).toBe('dashboard');
      expect(table.hideGeneratedNames).toBe(true);
      expect(c.fixture.nativeElement.querySelector('mat-select[aria-label="Date range"]').textContent).toContain('Last 30 days');
      expect(c.haptics.selection).not.toHaveBeenCalled();
      expect(c.events.getEventsPageOnceByWithMeta).not.toHaveBeenCalled();
      expect(c.events.getEventCountBy).not.toHaveBeenCalled(); expect(c.events.getEventCount).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('filters tags, sports and untagged locally without starting new queries', async () => {
    const c = await setup(); await render(c);
    c.component.selectTag('ENDURANCE'); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['a', 'b']);
    c.component.selectSport('Ride'); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['b']);
    c.component.selectSport('Cycling'); c.component.selectTag('endurance');
    expect(c.haptics.selection).toHaveBeenCalledTimes(2);
    c.component.clearFilters(); await render(c);
    expect(c.component.period()).toBe('month'); expect(c.component.filteredEvents()).toHaveLength(3);
    c.component.selectTag(c.component.untaggedOption); await render(c);
    expect(c.component.filteredEvents()).toEqual([]);
    expect(c.events.getEventsBy).toHaveBeenCalledOnce();
    expect(c.catalog.listAllTags).toHaveBeenCalledOnce();
  });

  it('loads All dates only when explicitly selected and resets to the bounded default', async () => {
    const c = await setup(); await render(c);
    c.component.selectPeriod('all'); await render(c);
    expect(c.events.getEventsBy).toHaveBeenLastCalledWith(c.user$.value, [], 'startDate', false, 0);
    c.component.selectTag('Endurance'); await render(c);
    expect(c.events.getEventsBy).toHaveBeenCalledTimes(2);
    c.component.clearFilters(); await render(c);
    expect(c.component.period()).toBe('month');
    expect(c.events.getEventsBy.mock.lastCall[1]).toHaveLength(2);
    expect(c.events.getEventsBy).toHaveBeenCalledTimes(3);
    c.component.clearFilters(); expect(c.events.getEventsBy).toHaveBeenCalledTimes(3);
  });

  it('hydrates saved filters silently and only queries again when the date range changes', async () => {
    const c = await setup('Endurance'); await render(c);
    expect(c.component.filteredEvents()).toHaveLength(2);
    c.params$.next(convertToParamMap({ tag: 'Recovery', sport: 'Run', period: 'month' })); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['c']);
    expect(c.events.getEventsBy).toHaveBeenCalledOnce();
    c.params$.next(convertToParamMap({ untagged: '1', period: 'all' })); await render(c);
    expect(c.component.untagged()).toBe(true); expect(c.component.filteredEvents()).toEqual([]);
    expect(c.events.getEventsBy).toHaveBeenCalledTimes(2);
    expect(c.haptics.selection).not.toHaveBeenCalled();
  });

  it('keeps literal tag names separate from the Untagged option', async () => {
    const c = await setup();
    c.events.getEventsBy.mockReturnValue(of([event('empty', []), event('named', ['__none'])])); await render(c);
    c.component.selectTag(c.component.untaggedOption); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['empty']);
    c.component.selectTag('__none'); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['named']);
    expect(c.events.getEventsBy).toHaveBeenCalledOnce();
  });

  it('matches canonical sport aliases and excludes generated comparisons from the table', async () => {
    const c = await setup();
    c.events.getEventsBy.mockReturnValue(of([
      { ...event('run', []), getActivityTypesAsArray: () => ['Run'] },
      { ...event('running', []), getActivityTypesAsArray: () => ['Running'] },
      { ...event('comparison', []), isMerge: true },
      { ...event('benchmark', []), hasBenchmark: true },
    ]));
    c.params$.next(convertToParamMap({ sport: 'run' })); await render(c);
    expect(c.component.selectedSport()).toBe('Running'); expect(c.component.filteredEvents()).toHaveLength(2);
    expect(c.component.sports()).toContain('Cycling');
    c.component.selectSport('Run'); expect(c.haptics.selection).not.toHaveBeenCalled();
    expect(c.events.getEventsBy).toHaveBeenCalledOnce();
  });

  it('uses one live listener for subsequent activity updates without repeating the query', async () => {
    const c = await setup(); const live = new Subject<AppEventInterface[]>();
    c.events.getEventsBy.mockReturnValue(live); c.fixture.detectChanges();
    expect(c.component.loading()).toBe(true);
    live.next(records); await render(c);
    live.next([...records, event('new', [])]); await render(c);
    expect(c.component.events()).toHaveLength(4); expect(c.events.getEventsBy).toHaveBeenCalledOnce();
    expect(c.haptics.selection).not.toHaveBeenCalled(); expect(c.haptics.error).not.toHaveBeenCalled();
  });

  it('cancels the previous listener on range changes, account changes and teardown', async () => {
    const c = await setup(); const first = new Subject<AppEventInterface[]>();
    const session = new Subject<AppEventInterface[]>();
    c.events.getEventsBy.mockReturnValueOnce(first); c.fixture.detectChanges();
    expect(first.observed).toBe(true);
    c.component.selectPeriod('year'); await render(c); expect(first.observed).toBe(false);
    first.next([event('old-range', ['Private'])]); expect(c.component.events()).toEqual(records);
    c.events.getEventsBy.mockReturnValueOnce(session); c.component.refresh();
    c.auth.currentUser = { uid: 'owner' }; c.authState$.next(c.auth.currentUser); await render(c);
    expect(session.observed).toBe(false);
    session.next([event('old-owner', ['Private'])]); expect(c.component.events()).toEqual(records);
    const last = new Subject<AppEventInterface[]>(); c.events.getEventsBy.mockReturnValueOnce(last); c.component.refresh();
    expect(last.observed).toBe(true); c.fixture.destroy(); expect(last.observed).toBe(false);
    last.next([event('destroyed', [])]); expect(c.component.events()).toEqual([]);
  });

  it('retries a failed range query with one action feedback and only reports explicit failures', async () => {
    const c = await setup();
    c.events.getEventsBy.mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(throwError(() => new Error('still offline')));
    await render(c); expect(c.component.historyError()).toBe(true);
    expect(c.haptics.error).not.toHaveBeenCalled();
    c.component.retryActivities(); await render(c);
    expect(c.haptics.selection).toHaveBeenCalledOnce(); expect(c.haptics.error).toHaveBeenCalledOnce();
    c.component.retryActivities(); await render(c);
    expect(c.component.events()).toEqual(records); expect(c.component.historyError()).toBe(false);
    const reads = c.events.getEventsBy.mock.calls.length;
    c.component.retryActivities(); expect(c.events.getEventsBy).toHaveBeenCalledTimes(reads);
  });

  it('applies confirmed edits and deletions without restarting the live query', async () => {
    const c = await setup('Endurance'); await render(c);
    c.component.onEventsChange({ userID: 'owner', updatedTags: { b: ['New label'] }, deletedEventIDs: ['a'] }); await render(c);
    expect(c.component.filteredEvents()).toEqual([]);
    expect(c.component.library().map(t => t.name)).toContain('New label');
    c.component.selectTag('New label'); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['b']);
    expect(c.component.filteredEvents()[0].benchmarkReviewTags).toBeUndefined();
    c.component.onEventsChange({ userID: 'owner', updatedTags: { b: [] }, deletedEventIDs: [] });
    c.component.selectTag(c.component.untaggedOption); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['b']);
    expect(c.events.getEventsBy).toHaveBeenCalledOnce();
  });

  it('ignores detached table mutations from a previous account', async () => {
    const c = await setup(); await render(c);
    const table = c.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
    c.auth.currentUser = { uid: 'other' }; c.authState$.next(c.auth.currentUser); c.user$.next(new User('other') as AppUserInterface); await render(c);
    table.eventsChange.emit({ userID: 'owner', updatedTags: { a: ['Private'] }, deletedEventIDs: ['b'] }); await render(c);
    expect(c.component.events()).toEqual(records); expect(c.component.library().map(t => t.name)).not.toContain('Private');
  });

  it('keeps the table instance and query when unit, column, sort or page-size preferences change', async () => {
    const c = await setup(); await render(c);
    const table = c.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
    const previousEvents = table.events;
    const profile = new User('owner') as AppUserInterface;
    profile.settings = AppUserUtilities.fillMissingAppSettings(profile);
    profile.settings.unitSettings = { ...getDefaultUserUnitSettings(), distanceUnits: DistanceUnits.Miles };
    profile.settings.dashboardSettings.tableSettings.eventsPerPage = 25;
    c.user$.next(profile); await render(c);
    expect(c.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance).toBe(table);
    expect(table.user.settings.unitSettings.distanceUnits).toBe(DistanceUnits.Miles);
    expect(table.events).not.toBe(previousEvents); expect(table.events).toEqual(previousEvents);
    expect(c.events.getEventsBy).toHaveBeenCalledOnce();
  });

  it('retries tag catalog errors without refetching activities', async () => {
    const c = await setup(); c.catalog.listAllTags.mockRejectedValueOnce(new Error('offline')); await render(c);
    expect(c.component.catalogError()).toBe(true); c.component.retryCatalog(); await render(c);
    expect(c.catalog.listAllTags).toHaveBeenLastCalledWith('owner', true);
    expect(c.events.getEventsBy).toHaveBeenCalledOnce();
  });

  it('retains an in-flight tag catalog across date range changes', async () => {
    const c = await setup(); let resolveTags: (tags: string[]) => void;
    c.catalog.listAllTags.mockReturnValueOnce(new Promise<string[]>(resolve => { resolveTags = resolve; }));
    c.fixture.detectChanges(); c.component.selectPeriod('year');
    resolveTags!(['Saved tag']); await render(c);
    expect(c.component.catalogLoading()).toBe(false); expect(c.component.library().map(t => t.name)).toContain('Saved tag');
    expect(c.catalog.listAllTags).toHaveBeenCalledOnce();
  });

  it('rolls relative date bounds forward at midnight silently and cleans up its listener and clock', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(new Date(2026, 9, 21, 23, 59, 30));
    const c = await setup();
    try {
      c.params$.next(convertToParamMap({ period: 'week' })); await render(c);
      const clock = vi.spyOn(c.component, 'refreshLocalDay');
      await vi.advanceTimersByTimeAsync(60_000); await render(c);
      expect(c.events.getEventsBy).toHaveBeenCalledTimes(2);
      expect(c.events.getEventsBy.mock.lastCall[1]).toEqual([
        { fieldPath: 'startDate', opStr: '>=', value: new Date(2026, 9, 16).getTime() },
        { fieldPath: 'startDate', opStr: '<', value: new Date(2026, 9, 23).getTime() },
      ]);
      expect(c.haptics.selection).not.toHaveBeenCalled();
      c.fixture.destroy(); await vi.advanceTimersByTimeAsync(60_000); expect(clock).toHaveBeenCalledOnce();
    } finally { c.fixture.destroy(); vi.useRealTimers(); }
  });

  it('uses the real shared paginator, totals, full search and metric sorting without extra queries', async () => {
    const c = await setup('', true);
    c.user$.value.settings.dashboardSettings.tableSettings.eventsPerPage = 10;
    const data = Array.from({ length: 12 }, (_, i) => {
      const record = EventImporterJSON.getEventFromJSON({
        name: 'Workout ' + i, startDate: Date.now(), endDate: Date.now(), srcFileType: FileType.FIT,
        description: null, isMerge: false, privacy: Privacy.Private, stats: {}, activities: [],
      }) as AppEventInterface;
      record.setID('activity-' + i);
      record.addStat(new DataActivityTypes([ActivityTypes.Running]));
      record.addStat(new DataDeviceNames([])); record.addStat(new DataDistance(1000 + i * 100));
      record.tags = [i < 6 ? 'Endurance' : 'Recovery'];
      return record;
    });
    c.events.getEventsBy.mockReturnValue(of(data)); await render(c);
    const table = c.fixture.debugElement.query(By.directive(EventTableComponent)).componentInstance as EventTableComponent;
    expect(c.fixture.nativeElement.querySelectorAll('mat-paginator')).toHaveLength(1);
    expect(table.data.paginator).toBe(table.paginator); expect(table.data.sort).toBe(table.sort);
    expect(c.fixture.nativeElement.querySelector('mat-paginator').textContent).toContain('1 – 10 of 12');
    table.paginator.nextPage(); await render(c);
    expect(c.fixture.nativeElement.querySelector('mat-paginator').textContent).toContain('11 – 12 of 12');
    table.search('Workout 2'); await render(c);
    expect(table.data.filteredData).toHaveLength(1);
    expect(c.fixture.nativeElement.querySelector('mat-paginator').textContent).toContain('1 – 1 of 1');
    table.clearSearch(); await render(c);
    table.sort.sort({ id: 'Distance', start: 'asc', disableClear: true }); await render(c);
    expect(table.data.sortData(table.data.filteredData, table.sort)[0].Event.getID()).toBe('activity-0');
    c.component.selectTag('Endurance'); await render(c);
    expect(c.fixture.nativeElement.querySelector('mat-paginator').textContent).toContain('1 – 6 of 6');
    c.component.clearFilters(); await render(c);
    const columns = c.fixture.debugElement.query(By.directive(EventTableActionsComponent)).componentInstance as EventTableActionsComponent;
    columns.selectedDataTypesChange.emit(['Duration', 'Distance']); await render(c);
    expect(c.userService.updateUserProperties).toHaveBeenCalled();
    expect(c.events.getEventsBy).toHaveBeenCalledOnce();
    expect(c.events.getEventsPageOnceByWithMeta).not.toHaveBeenCalled();
    expect(c.events.getEventCountBy).not.toHaveBeenCalled(); expect(c.events.getEventCount).not.toHaveBeenCalled();
  });

  it('does not duplicate a date query when a range is changed after midnight or its URL is updated', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 21, 23, 59));
    try {
      const c = await setup(); await render(c);
      vi.setSystemTime(new Date(2026, 9, 22, 0, 1));
      c.component.selectPeriod('week'); await render(c);
      expect(c.events.getEventsBy).toHaveBeenCalledTimes(2);
      expect(c.events.getEventsBy.mock.lastCall[1]).toEqual([
        { fieldPath: 'startDate', opStr: '>=', value: new Date(2026, 9, 16).getTime() },
        { fieldPath: 'startDate', opStr: '<', value: new Date(2026, 9, 23).getTime() },
      ]);
      c.params$.next(convertToParamMap({ tag: 'Endurance', period: 'week' })); await render(c);
      expect(c.events.getEventsBy).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
