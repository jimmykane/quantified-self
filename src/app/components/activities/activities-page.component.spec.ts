import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { By } from '@angular/platform-browser';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DistanceUnits, User, type EventInterface } from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import type { AppEventInterface } from '@shared/app-event.interface';
import type { AppUserInterface } from '../../models/app-user.interface';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppEventService, type EventQueryCursor, type GetEventsPageResult } from '../../services/app.event.service';
import { EventTagCatalogService } from '../../services/event-tag-catalog.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppUserService } from '../../services/app.user.service';
import { AppEventMergeService } from '../../services/app.event-merge.service';
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
import { EventTableComponent, type EventTableEventsChange, type EventTablePagination } from '../event-table/event.table.component';
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
  @Input() pagination: EventTablePagination;
  @Output() pageRequest = new EventEmitter<{ pageIndex: number; pageSize: number; length: number }>();
  @Output() searchChange = new EventEmitter<string>();
  @Output() dateSortChange = new EventEmitter<'asc' | 'desc'>();
  @Output() eventsChange = new EventEmitter<EventTableEventsChange>();
}

function event(id: string, tags: string[], legacy = false): AppEventInterface {
  return { getID: () => id, startDate: new Date(), getActivityTypesAsArray: () => [id === 'b' ? 'Cycling' : 'Running'], ...(legacy ? { benchmarkReviewTags: tags } : { tags }) } as AppEventInterface;
}
const records = [event('a', ['endurance']), event('b', ['ENDURANCE'], true), event('c', ['Recovery'])];
const cursor = { id: 'last-page-doc' } as EventQueryCursor;
const page = (events = records.map(record => ({ ...record })), hasMore = false, lastCursor = cursor): GetEventsPageResult => ({ events, hasMore, source: 'server', firstCursor: cursor, lastCursor });

async function setup(tag = '', realTable = false) {
  const owner = { uid: 'owner' };
  const user = new User('owner') as AppUserInterface;
  if (realTable) user.settings = AppUserUtilities.fillMissingAppSettings(user);
  const user$ = new BehaviorSubject(user);
  const authState$ = new BehaviorSubject(owner);
  const auth = { user$, authState$, currentUser: owner };
  const params$ = new BehaviorSubject(convertToParamMap(tag ? { tag } : {}));
  const events = { getEventsPageOnceByWithMeta: vi.fn().mockReturnValue(of(page())) };
  const catalog = { listAllTags: vi.fn().mockResolvedValue(['Endurance', 'Race day', 'Recovery']) };
  const haptics = { selection: vi.fn(), error: vi.fn() };
  const userService = { updateUserProperties: vi.fn().mockResolvedValue(undefined) };
  const router = { navigate: vi.fn().mockResolvedValue(true) };
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
        ...[AppEventMergeService, AppEventColorService, AppFileService, AppOriginalFileDownloadService,
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
  it('queries the default date range and uses the full events table with one paginator', async () => {
    const c = await setup(); await render(c);
    const query = c.events.getEventsPageOnceByWithMeta.mock.calls[0];
    expect(query.slice(2, 5)).toEqual(['startDate', false, 250]);
    expect(query[1]).toEqual([]);
    const table = c.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
    expect(table.events).toEqual(records);
    expect(table.pagination).toMatchObject({ pageIndex: 0, pageSize: 25, hasNext: false });
    expect(table.presentation).toBe('dashboard'); expect(table.hideGeneratedNames).toBe(true);
    expect(c.fixture.nativeElement.textContent).not.toMatch(/loaded history|Load older/);
    expect(c.fixture.nativeElement.querySelector('mat-select[aria-label="Date range"]').textContent).toContain('All dates');
    expect(c.haptics.selection).not.toHaveBeenCalled();
  });

  it('fetches only enough results for a page and lookahead, buffers the rest and supports cached Previous', async () => {
    const c = await setup();
    c.user$.value.settings = AppUserUtilities.fillMissingAppSettings(c.user$.value);
    c.user$.value.settings.dashboardSettings.tableSettings.eventsPerPage = 10;
    const first = Array.from({ length: 12 }, (_, i) => event('first-' + i, []));
    const second = Array.from({ length: 16 }, (_, i) => event('second-' + i, []));
    c.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(of(page(first, true))).mockReturnValueOnce(of(page(second, false)));
    await render(c);
    expect(c.component.events()).toEqual(first.slice(0, 10));
    expect(c.events.getEventsPageOnceByWithMeta).toHaveBeenCalledOnce();
    expect(c.component.hasMore()).toBe(true);
    c.component.onPageRequest({ pageIndex: 1, pageSize: 10, length: 11 }); await render(c);
    expect(c.component.events()).toEqual([...first.slice(10), ...second.slice(0, 8)]);
    expect(c.events.getEventsPageOnceByWithMeta.mock.calls[1][5].startAfterCursor).toBe(cursor);
    c.component.onPageRequest({ pageIndex: 2, pageSize: 10, length: 21 }); await render(c);
    expect(c.component.events()).toEqual(second.slice(8)); expect(c.component.hasMore()).toBe(false);
    c.component.onPageRequest({ pageIndex: 1, pageSize: 10, length: 28 }); await render(c);
    expect(c.component.events()).toHaveLength(10);
    expect(c.events.getEventsPageOnceByWithMeta).toHaveBeenCalledTimes(2);
    expect(c.haptics.selection).not.toHaveBeenCalled();
  });

  it('finds tags beyond the first source batch and does not show a false empty page', async () => {
    const c = await setup('RACE'); const pending = new Subject<GetEventsPageResult>();
    c.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(of(page([event('unrelated', [])], true))).mockReturnValueOnce(pending);
    c.fixture.detectChanges(); await Promise.resolve(); await Promise.resolve();
    expect(c.component.loading()).toBe(true); expect(c.component.emptyMessage()).toBe('Loading activities…');
    pending.next(page([event('older-race', ['race'], true)], false)); pending.complete(); await render(c);
    expect(c.component.events().map(e => e.getID())).toEqual(['older-race']);
    expect(c.events.getEventsPageOnceByWithMeta.mock.calls[0][1]).toEqual([]);
    expect(c.component.hasMore()).toBe(false); expect(c.component.historyError()).toBe(false);
  });

  it('resets paging when tags, sports, search, date range or date order change, with silent search', async () => {
    const c = await setup(); await render(c);
    c.component.selectTag('endurance'); await render(c);
    expect(c.component.events().map(e => e.getID())).toEqual(['a', 'b']);
    c.component.selectSport('Ride'); await render(c);
    expect(c.component.events().map(e => e.getID())).toEqual(['b']);
    c.component.onSearchChange('missing'); await render(c);
    expect(c.component.events()).toEqual([]); expect(c.haptics.selection).toHaveBeenCalledTimes(2);
    c.component.selectPeriod('all'); await render(c);
    expect(c.events.getEventsPageOnceByWithMeta.mock.lastCall[1]).toEqual([]);
    c.component.onDateSortChange('asc'); await render(c);
    expect(c.events.getEventsPageOnceByWithMeta.mock.lastCall[3]).toBe(true);
    const calls = c.events.getEventsPageOnceByWithMeta.mock.calls.length;
    c.component.selectSport('Cycling'); c.component.selectTag('ENDURANCE'); c.component.onSearchChange(' MISSING '); c.component.selectPeriod('all');
    expect(c.events.getEventsPageOnceByWithMeta).toHaveBeenCalledTimes(calls);
    expect(c.component.pageIndex()).toBe(0);
  });

  it('keeps Untagged separate from literal tag names and restores links without feedback', async () => {
    const c = await setup();
    c.events.getEventsPageOnceByWithMeta.mockReturnValue(of(page([event('empty', []), event('named', ['__none'])])));
    await render(c);
    c.component.selectTag(c.component.untaggedOption); await render(c);
    expect(c.component.events().map(e => e.getID())).toEqual(['empty']);
    c.component.selectTag('__none'); await render(c);
    expect(c.component.events().map(e => e.getID())).toEqual(['named']);
    c.params$.next(convertToParamMap({ untagged: '1', period: 'all' })); await render(c);
    expect(c.component.events().map(e => e.getID())).toEqual(['empty']);
    expect(c.haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('hydrates canonical sport aliases and offers sports absent from the current page', async () => {
    const c = await setup();
    c.events.getEventsPageOnceByWithMeta.mockReturnValue(of(page([
      { ...event('run', []), getActivityTypesAsArray: () => ['Run'] },
      { ...event('running', []), getActivityTypesAsArray: () => ['Running'] },
    ])));
    c.params$.next(convertToParamMap({ sport: 'run' })); await render(c);
    expect(c.component.selectedSport()).toBe('Running'); expect(c.component.events()).toHaveLength(2);
    expect(c.component.sports()).toContain('Cycling');
    c.component.selectSport('Run'); expect(c.haptics.selection).not.toHaveBeenCalled();
  });

  it('de-duplicates source pages and excludes generated comparisons while advancing source cursors', async () => {
    const c = await setup();
    c.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(of(page([records[0], { ...event('comparison', []), isMerge: true }], true)))
      .mockReturnValueOnce(of(page([records[0], records[1]], false)));
    await render(c); expect(c.component.events().map(e => e.getID())).toEqual(['a', 'b']);
    expect(c.events.getEventsPageOnceByWithMeta.mock.calls[1][5].startAfterCursor).toBe(cursor);
  });

  it('stops an invalid repeated cursor and permits retry instead of looping', async () => {
    const c = await setup();
    c.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(of(page([], true))).mockReturnValueOnce(of(page([], true)));
    await render(c); expect(c.component.historyError()).toBe(true);
    expect(c.events.getEventsPageOnceByWithMeta).toHaveBeenCalledTimes(2);
    await c.component.retryActivities(); await render(c);
    expect(c.component.events()).toEqual(records); expect(c.component.historyError()).toBe(false);
  });

  it('keeps the current page on Next failure and retries the requested next page with one feedback', async () => {
    const c = await setup();
    c.user$.value.settings = AppUserUtilities.fillMissingAppSettings(c.user$.value);
    c.user$.value.settings.dashboardSettings.tableSettings.eventsPerPage = 10;
    const first = Array.from({ length: 11 }, (_, i) => event('first-' + i, []));
    c.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(of(page(first, true))).mockReturnValueOnce(throwError(() => new Error('offline')));
    await render(c); c.component.onPageRequest({ pageIndex: 1, pageSize: 10, length: 11 }); await render(c);
    expect(c.component.pageIndex()).toBe(0); expect(c.component.events()).toEqual(first.slice(0, 10));
    expect(c.component.historyError()).toBe(true); expect(c.haptics.error).toHaveBeenCalledOnce();
    await c.component.retryActivities(); await render(c);
    expect(c.component.pageIndex()).toBe(1); expect(c.component.events()[0]).toEqual(first[10]);
    expect(c.haptics.selection).toHaveBeenCalledOnce();
    expect(c.events.getEventsPageOnceByWithMeta.mock.lastCall[5].startAfterCursor).toBe(cursor);
  });

  it('rejects stale date-query results and owner data, including a replacement session for the same UID', async () => {
    const c = await setup(); const pending = new Subject<GetEventsPageResult>();
    c.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(pending); c.fixture.detectChanges();
    c.component.selectPeriod('year'); await render(c);
    pending.next(page([event('stale-date', ['Private'])])); pending.complete(); await render(c);
    expect(c.component.events().map(e => e.getID())).not.toContain('stale-date');
    const ownerPending = new Subject<GetEventsPageResult>(); c.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(ownerPending);
    c.component.refresh();
    c.auth.currentUser = { uid: 'owner' }; c.authState$.next(c.auth.currentUser); await render(c);
    ownerPending.next(page([event('old-session', ['Private'])])); ownerPending.complete(); await render(c);
    expect(c.component.events().map(e => e.getID())).not.toContain('old-session');
  });

  it('discards late reads after teardown and never requests another source page', async () => {
    const c = await setup(); const pending = new Subject<GetEventsPageResult>();
    c.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(pending); c.fixture.detectChanges(); c.fixture.destroy();
    pending.next(page([event('after-destroy', [])], true)); pending.complete(); await Promise.resolve(); await Promise.resolve();
    expect(c.events.getEventsPageOnceByWithMeta).toHaveBeenCalledOnce(); expect(c.component.events()).toEqual([]);
  });

  it('requeries confirmed edits and deletions and fences any read started before the write', async () => {
    const c = await setup('Endurance'); await render(c);
    const pending = new Subject<GetEventsPageResult>(); c.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(pending); c.component.refresh();
    const saved = { ...event('b', ['New label']), name: 'Fresh title' };
    c.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(of(page([saved, records[2]])));
    c.component.onEventsChange({ userID: 'owner', updatedTags: { b: ['New label'] }, deletedEventIDs: ['a'] }); await render(c);
    pending.next(page(records)); pending.complete(); await render(c);
    expect(c.component.events()).toEqual([]); expect(c.component.library().map(t => t.name)).toContain('New label');
    c.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(of(page([saved])));
    c.component.selectTag('New label'); await render(c);
    expect(c.component.events()[0]?.name).toBe('Fresh title');
  });

  it('ignores detached table mutations after account changes', async () => {
    const c = await setup(); await render(c);
    const table = c.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
    c.auth.currentUser = { uid: 'other' }; c.authState$.next(c.auth.currentUser); c.user$.next(new User('other') as AppUserInterface); await render(c);
    table.eventsChange.emit({ userID: 'owner', updatedTags: { a: ['Private tag'] }, deletedEventIDs: ['b'] }); await render(c);
    expect(c.component.events()).toEqual(records); expect(c.component.library().map(t => t.name)).not.toContain('Private tag');
  });

  it('keeps the table instance on unit preference changes without refetching', async () => {
    const c = await setup(); await render(c);
    const table = c.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
    const previousEvents = table.events;
    const profile = new User('owner') as AppUserInterface;
    profile.settings = { unitSettings: { ...getDefaultUserUnitSettings(), distanceUnits: DistanceUnits.Miles } } as AppUserInterface['settings'];
    c.user$.next(profile); await render(c);
    expect(c.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance).toBe(table);
    expect(table.user.settings.unitSettings.distanceUnits).toBe(DistanceUnits.Miles);
    expect(table.events).not.toBe(previousEvents);
    expect(table.events).toEqual(previousEvents);
    expect(c.events.getEventsPageOnceByWithMeta).toHaveBeenCalledOnce();
  });

  it('retries catalog errors and retains catalog results through date changes', async () => {
    const c = await setup(); c.catalog.listAllTags.mockRejectedValueOnce(new Error('offline')); await render(c);
    expect(c.component.catalogError()).toBe(true); c.component.retryCatalog(); await render(c);
    expect(c.catalog.listAllTags).toHaveBeenLastCalledWith('owner', true);
    c.component.selectPeriod('year'); await render(c);
    expect(c.component.library().map(t => t.name)).toContain('Race day');
    expect(c.catalog.listAllTags).toHaveBeenCalledTimes(2);
  });

  it('rolls a relative range forward at midnight silently and cleans up its clock', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(new Date(2026, 9, 21, 23, 59, 30));
    const c = await setup();
    try {
      c.params$.next(convertToParamMap({ period: 'week' }));
      await render(c); const clock = vi.spyOn(c.component, 'refreshLocalDay');
      await vi.advanceTimersByTimeAsync(60_000); await render(c);
      expect(c.events.getEventsPageOnceByWithMeta).toHaveBeenCalledTimes(2);
      expect(c.events.getEventsPageOnceByWithMeta.mock.lastCall[1]).toEqual([
        { fieldPath: 'startDate', opStr: '>=', value: new Date(2026, 9, 16) },
        { fieldPath: 'startDate', opStr: '<', value: new Date(2026, 9, 23) },
      ]);
      expect(c.haptics.selection).not.toHaveBeenCalled();
      c.fixture.destroy(); await vi.advanceTimersByTimeAsync(60_000); expect(clock).toHaveBeenCalledOnce();
    } finally { c.fixture.destroy(); vi.useRealTimers(); }
  });

  it('projects filters into the real table and connects the debounced search and page events', async () => {
    const c = await setup('', true); c.events.getEventsPageOnceByWithMeta.mockReturnValue(of(page([]))); await render(c);
    const table = c.fixture.debugElement.query(By.directive(EventTableComponent)).componentInstance as EventTableComponent;
    expect(c.fixture.nativeElement.querySelectorAll('mat-paginator')).toHaveLength(1);
    expect(table.data.paginator).toBeNull(); expect(table.data.sort).toBeNull();
    expect(c.fixture.nativeElement.querySelector('.table-toolbar button[aria-label="Configure table columns"]')).toBeTruthy();
    const pending = new Subject<GetEventsPageResult>();
    c.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(pending);
    table.search('Endurance'); c.fixture.detectChanges();
    expect(c.component.loading()).toBe(true);
    expect(c.fixture.nativeElement.textContent).not.toContain('No activities match');
    pending.next(page([])); pending.complete(); await render(c);
    expect(c.component.searchTerm()).toBe('Endurance');
    expect(c.events.getEventsPageOnceByWithMeta).toHaveBeenCalledTimes(2);
    expect(c.haptics.selection).not.toHaveBeenCalled();
    c.component.selectTag('Endurance'); await render(c);
    expect(table.searchTerm).toBe('Endurance');
    const columns = c.fixture.debugElement.query(By.directive(EventTableActionsComponent)).componentInstance as EventTableActionsComponent;
    columns.selectedDataTypesChange.emit(['Duration', 'Distance']); await render(c);
    expect(c.userService.updateUserProperties).toHaveBeenCalled();
  });
});
