import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
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
import { LoggerService } from '../../services/logger.service';
import { EventTableModule } from '../../modules/event-table.module';
import type { EventTableEventsChange } from '../event-table/event.table.component';
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
const cursor = { id: 'last-page-doc' } as EventQueryCursor;
const page = (events = records.map(record => ({ ...record })), hasMore = true): GetEventsPageResult => ({ events, hasMore, source: 'server', firstCursor: cursor, lastCursor: cursor });

async function setup(tag = '') {
  const owner = { uid: 'owner' };
  const user$ = new BehaviorSubject(new User('owner') as AppUserInterface);
  const authState$ = new BehaviorSubject(owner);
  const auth = { user$, authState$, currentUser: owner };
  const params$ = new BehaviorSubject(convertToParamMap(tag ? { tag } : {}));
  const events = { getEventsPageOnceByWithMeta: vi.fn().mockReturnValue(of(page())) };
  const catalog = { listAllTags: vi.fn().mockResolvedValue(['Endurance', 'Race day', 'Recovery']) };
  const haptics = { selection: vi.fn(), error: vi.fn() };
  const router = { navigate: vi.fn().mockResolvedValue(true) };
  await TestBed.configureTestingModule({
    imports: [ActivitiesPageComponent, NoopAnimationsModule],
    providers: [
      { provide: AppAuthService, useValue: auth },
      { provide: AppEventService, useValue: events },
      { provide: EventTagCatalogService, useValue: catalog },
      { provide: AppHapticsService, useValue: haptics },
      { provide: ActivatedRoute, useValue: { queryParamMap: params$ } },
      { provide: Router, useValue: router },
      { provide: LoggerService, useValue: { warn: vi.fn() } },
    ],
  }).overrideComponent(ActivitiesPageComponent, { remove: { imports: [EventTableModule] }, add: { imports: [EventTableStub] } }).compileComponents();
  const fixture = TestBed.createComponent(ActivitiesPageComponent);
  return { fixture, component: fixture.componentInstance, auth, user$, authState$, params$, events, catalog, haptics, router };
}
async function render(context: Awaited<ReturnType<typeof setup>>) {
  context.fixture.detectChanges();
  await context.fixture.whenStable();
  context.fixture.detectChanges();
}

describe('ActivitiesPageComponent', () => {
  it('loads bounded owner history, labels partial counts, and binds the existing events table', async () => {
    const context = await setup();
    await render(context);
    expect(context.events.getEventsPageOnceByWithMeta).toHaveBeenCalledWith(context.user$.value, [], 'startDate', false, 250, { startAfterCursor: null, requireServer: true });
    expect(context.component.complete()).toBe(false);
    expect(context.fixture.nativeElement.textContent).toContain('Filters and search cover loaded history');
    const table = context.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
    expect(table.events).toEqual(records);
    expect(table.showTagFilter).toBe(false);
    expect(table.showActions).toBe(true);
    expect(table.presentation).toBe('dashboard');
    expect(table.hideGeneratedNames).toBe(true);
    expect(table.preserveSearchOnFilterChange).toBe(true);
    expect(context.haptics.selection).not.toHaveBeenCalled();
  });

  it('hydrates deep links silently and filters case-insensitive canonical and legacy tags', async () => {
    const context = await setup('ENDURANCE');
    await render(context);
    expect(context.component.filteredEvents().map(value => value.getID())).toEqual(['a', 'b']);
    expect(context.component.selectedName()).toBe('Endurance');
    context.component.selectTag('endurance');
    expect(context.haptics.selection).not.toHaveBeenCalled();
    context.component.selectTag('Recovery');
    context.fixture.detectChanges();
    expect(context.component.filteredEvents().map(value => value.getID())).toEqual(['c']);
    expect(context.haptics.selection).toHaveBeenCalledOnce();
    expect(context.router.navigate).toHaveBeenCalledOnce();
    expect(context.router.navigate.mock.calls[0][1].queryParams).toMatchObject({ tag: 'Recovery' });
    context.params$.next(convertToParamMap({ tag: 'Endurance' }));
    expect(context.component.filteredEvents()).toHaveLength(2);
    expect(context.haptics.selection).toHaveBeenCalledOnce();
  });

  it('forwards updated unit preferences to the same owner table without another history read or haptic', async () => {
    const context = await setup();
    await render(context);
    const table = context.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
    const profile = new User('owner') as AppUserInterface;
    const previousEventsInput = table.events;
    profile.settings = { ...profile.settings, unitSettings: { ...getDefaultUserUnitSettings(), distanceUnits: DistanceUnits.Miles } };
    context.user$.next(profile);
    context.fixture.detectChanges();
    expect(context.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance).toBe(table);
    expect(table.user.settings.unitSettings.distanceUnits).toBe(DistanceUnits.Miles);
    expect(table.events).not.toBe(previousEventsInput);
    expect(context.events.getEventsPageOnceByWithMeta).toHaveBeenCalledOnce();
    expect(context.haptics.selection).not.toHaveBeenCalled();
  });

  it('renders the top tag selector with saved tags and gives accepted selections one haptic', async () => {
    const context = await setup();
    await render(context);
    const selector = context.fixture.debugElement.query(By.css('mat-select[aria-label="Tags"]'));
    expect(selector).toBeTruthy();
    expect(context.fixture.nativeElement.querySelector('.tag-library-rail')).toBeNull();
    selector.triggerEventHandler('selectionChange', { value: 'Race day' });
    context.fixture.detectChanges();
    expect(context.component.selectedTag()).toBe('Race day');
    expect(context.component.emptyMessage()).toBe('No matching activities loaded yet');
    expect(context.haptics.selection).toHaveBeenCalledOnce();
    selector.triggerEventHandler('selectionChange', { value: 'race day' });
    expect(context.haptics.selection).toHaveBeenCalledOnce();
    expect(context.router.navigate.mock.calls[0][1].queryParams).toEqual({ tag: 'Race day', untagged: null, sport: null, period: null });
  });

  it('combines rendered sport and date filters with tags and clears filters through the chip toolbar', async () => {
    const context = await setup('Endurance');
    await render(context);
    context.fixture.debugElement.query(By.css('mat-select[aria-label="Sport"]')).triggerEventHandler('selectionChange', { value: 'Cycling' });
    context.fixture.debugElement.query(By.css('mat-select[aria-label="Date range"]')).triggerEventHandler('selectionChange', { value: 'week' });
    context.fixture.detectChanges();
    expect(context.component.filteredEvents().map(value => value.getID())).toEqual(['b']);
    const table = context.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
    expect(JSON.parse(table.filterContext)).toMatchObject({ tag: 'Endurance', sport: 'Cycling', period: 'week' });
    const clear = [...context.fixture.nativeElement.querySelectorAll('.activity-active-filters button')].find((button: HTMLButtonElement) => button.textContent.includes('Clear filters')) as HTMLButtonElement;
    clear.click();
    context.fixture.detectChanges();
    expect(context.component.filteredEvents()).toHaveLength(3);
    expect(context.component.hasFilters()).toBe(false);
    expect(context.haptics.selection).toHaveBeenCalledTimes(3);
    context.component.clearFilters();
    context.component.selectSport('');
    context.component.selectPeriod('all');
    expect(context.haptics.selection).toHaveBeenCalledTimes(3);
  });

  it('keeps untagged selection separate from every literal tag name and restores URL filters silently', async () => {
    const context = await setup();
    await render(context);
    context.component.events.update(events => [...events, event('untagged', []), event('named', ['__none'])]);
    context.component.selectTag(context.component.untaggedOption);
    expect(context.component.filteredEvents().map(value => value.getID())).toEqual(['untagged']);
    expect(context.router.navigate.mock.calls[0][1].queryParams).toMatchObject({ tag: null, untagged: '1' });
    context.component.selectTag('__none');
    expect(context.component.filteredEvents().map(value => value.getID())).toEqual(['named']);
    context.params$.next(convertToParamMap({ tag: 'ENDURANCE', sport: 'Cycling', period: 'week' }));
    context.fixture.detectChanges();
    expect(context.component.filteredEvents().map(value => value.getID())).toEqual(['b']);
    expect(context.component.tagFilterValue()).toBe('Endurance');
    expect(context.haptics.selection).toHaveBeenCalledTimes(2);
    context.params$.next(convertToParamMap({ untagged: '1' }));
    expect(context.component.filteredEvents().map(value => value.getID())).toEqual(['untagged']);
    expect(context.haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('omits generated comparisons from activity history while retaining the server cursor', async () => {
    const context = await setup();
    context.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(of(page([...records, { ...event('comparison', ['Race']), isMerge: true }])));
    await render(context);
    expect(context.component.events()).toHaveLength(3);
    await context.component.loadOlderActivities();
    expect(context.events.getEventsPageOnceByWithMeta.mock.calls[1][5].startAfterCursor).toBe(cursor);
  });

  it('appends older pages, de-duplicates records, and only then reports complete empty membership', async () => {
    const context = await setup('Race day');
    await render(context);
    context.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(of(page([records[0], event('older', ['Recovery'])], false)));
    await context.component.loadOlderActivities();
    context.fixture.detectChanges();
    expect(context.events.getEventsPageOnceByWithMeta.mock.calls[1][5]).toEqual({ startAfterCursor: cursor, requireServer: true });
    expect(context.component.events()).toHaveLength(4);
    expect(context.component.complete()).toBe(true);
    expect(context.component.emptyMessage()).toBe('No activities with this tag');
    expect(context.fixture.nativeElement.textContent).toContain('All activity history loaded');
    await context.component.loadOlderActivities();
    expect(context.haptics.selection).toHaveBeenCalledOnce();
  });

  it('keeps loaded rows and the cursor after failure, permits retry, and silences initial hydration errors', async () => {
    const context = await setup();
    context.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(throwError(() => new Error('offline')));
    await render(context);
    expect(context.haptics.error).not.toHaveBeenCalled();
    await context.component.loadOlderActivities();
    expect(context.component.events()).toEqual(records);
    context.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(throwError(() => new Error('offline')));
    await context.component.loadOlderActivities();
    expect(context.component.historyError()).toBe(true);
    expect(context.component.events()).toEqual(records);
    expect(context.haptics.error).toHaveBeenCalledOnce();
    await context.component.loadOlderActivities();
    expect(context.events.getEventsPageOnceByWithMeta.mock.calls[3][5].startAfterCursor).toBe(cursor);
    expect(context.component.historyError()).toBe(false);
  });

  it('rejects late history and catalog results after an account change or teardown', async () => {
    const context = await setup();
    const latePage = new Subject<GetEventsPageResult>();
    let resolveTags: (value: string[]) => void;
    context.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(latePage);
    context.catalog.listAllTags.mockReturnValueOnce(new Promise<string[]>(resolve => { resolveTags = resolve; }));
    context.fixture.detectChanges();
    const oldTable = context.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance;
    context.auth.currentUser = { uid: 'other' };
    context.authState$.next(context.auth.currentUser);
    context.user$.next(new User('other') as AppUserInterface);
    await render(context);
    expect(context.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance).not.toBe(oldTable);
    latePage.next(page([event('old-private', ['Private tag'])], false));
    resolveTags(['Private tag']);
    await render(context);
    expect(context.component.events().map(value => value.getID())).not.toContain('old-private');
    expect(context.component.library().map(tag => tag.name)).not.toContain('Private tag');
    const pending = new Subject<GetEventsPageResult>();
    context.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(pending);
    const request = context.component.loadOlderActivities();
    context.fixture.destroy();
    pending.next(page([event('after-destroy', ['Private tag'])], false));
    await request;
    expect(context.component.events().map(value => value.getID())).not.toContain('after-destroy');
  });

  it('reconciles tag edits and row deletion while preserving unrelated activities', async () => {
    const context = await setup('Endurance');
    await render(context);
    const table = context.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
    table.eventsChange.emit({ userID: 'owner', updatedTags: { a: ['New tag'] }, deletedEventIDs: ['b'] });
    context.fixture.detectChanges();
    expect(context.component.events().map(value => value.getID())).toEqual(['a', 'c']);
    expect(context.component.filteredEvents()).toHaveLength(0);
    expect(context.component.library().find(tag => tag.name === 'New tag')?.count).toBe(1);
    expect(context.component.library().find(tag => tag.name === 'Endurance')?.count).toBe(0);
    expect(context.haptics.selection).not.toHaveBeenCalled();
  });

  it('retains observed zero-count labels when an earlier catalog read finishes after a tag edit', async () => {
    const context = await setup();
    let resolveTags: (value: string[]) => void;
    context.catalog.listAllTags.mockReturnValueOnce(new Promise<string[]>(resolve => { resolveTags = resolve; }));
    context.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(of(page([event('legacy', ['Legacy label'], true)], false)));
    context.fixture.detectChanges();
    await Promise.resolve();
    context.component.onEventsChange({ userID: 'owner', updatedTags: { legacy: [] }, deletedEventIDs: [] });
    expect(context.component.library().find(tag => tag.name === 'Legacy label')?.count).toBe(0);
    resolveTags(['Race day']);
    await render(context);
    expect(context.component.library().find(tag => tag.name === 'Legacy label')?.count).toBe(0);
    expect(context.component.library().find(tag => tag.name === 'Race day')?.count).toBe(0);
    expect(context.haptics.selection).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'replaced tags', savedTags: ['New tag'] },
    { label: 'cleared tags', savedTags: [] },
  ])('does not replay a stale refresh snapshot over confirmed edits or deletions ($label)', async ({ savedTags }) => {
    const context = await setup('Endurance');
    await render(context);
    const pending = new Subject<GetEventsPageResult>();
    context.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(pending);
    context.component.refresh();
    const table = context.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
    table.eventsChange.emit({ userID: 'owner', updatedTags: { b: savedTags }, deletedEventIDs: ['a'] });
    const refreshed = { ...event('b', ['ENDURANCE'], true), name: 'Fresh server name' };
    pending.next(page([event('a', ['Endurance']), refreshed, event('c', ['Recovery'])], true));
    pending.complete();
    await render(context);
    expect(context.component.events().map(value => value.getID())).toEqual(['b', 'c']);
    expect(context.component.events()[0].tags).toEqual(savedTags);
    expect(context.component.events()[0].benchmarkReviewTags).toBeUndefined();
    expect(context.component.events()[0].name).toBe('Fresh server name');
    expect(context.component.filteredEvents()).toHaveLength(0);
    expect(context.component.library().find(tag => tag.name === 'Endurance')?.count).toBe(0);
    if (savedTags.length) expect(context.component.library().find(tag => tag.name === 'New tag')?.count).toBe(1);
    // A later read starts after the confirmed write and can supply newer tags.
    context.events.getEventsPageOnceByWithMeta.mockReturnValueOnce(of(page([event('b', ['Outdoors'])], false)));
    await context.component.loadOlderActivities();
    expect(context.component.events()[0].tags).toEqual(['Outdoors']);
  });

  it('keeps newly saved labels visible when their edited activity is outside the currently loaded history', async () => {
    const context = await setup();
    await render(context);
    context.component.onEventsChange({ userID: 'owner', updatedTags: { 'not-loaded': ['New saved label'] }, deletedEventIDs: [] });
    expect(context.component.events().map(value => value.getID())).toEqual(['a', 'b', 'c']);
    expect(context.component.library().find(tag => tag.name === 'New saved label')?.count).toBe(0);
    expect(context.haptics.selection).not.toHaveBeenCalled();
  });

  it('reconciles a late mutation after changing tags without inferring deletion from the new visible subset', async () => {
    const context = await setup('Endurance');
    await render(context);
    const table = context.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
    context.component.selectTag('Recovery');
    // The old table input can still be present until Angular renders the route change.
    table.eventsChange.emit({ userID: 'owner', updatedTags: { a: ['New tag'] }, deletedEventIDs: ['b'] });
    context.fixture.detectChanges();
    expect(context.component.events().map(value => value.getID())).toEqual(['a', 'c']);
    expect(context.component.filteredEvents().map(value => value.getID())).toEqual(['c']);
    context.component.selectTag('New tag');
    expect(context.component.filteredEvents().map(value => value.getID())).toEqual(['a']);
  });

  it('applies only confirmed tag fields to a fresh event instance and retains its newer metadata', async () => {
    const context = await setup('Endurance');
    await render(context);
    const refreshed = { ...event('a', ['endurance']), name: 'Newer name', benchmarkReviewTags: ['Legacy'] };
    context.component.events.set([refreshed, ...context.component.events().slice(1)]);
    const table = context.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
    table.eventsChange.emit({ userID: 'owner', updatedTags: { a: ['Recovery'] }, deletedEventIDs: [] });
    expect(context.component.events()[0]).toBe(refreshed);
    expect(context.component.events()[0].name).toBe('Newer name');
    expect(context.component.events()[0].tags).toEqual(['Recovery']);
    expect(context.component.events()[0].benchmarkReviewTags).toBeUndefined();
  });

  it('ignores an old table callback before Angular tears it down after an account switch', async () => {
    const context = await setup();
    await render(context);
    const oldTable = context.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
    context.auth.currentUser = { uid: 'other' };
    context.authState$.next(context.auth.currentUser);
    context.user$.next(new User('other') as AppUserInterface);
    await Promise.resolve();
    // New owner data can be ready before the old table's output is detached.
    expect(context.component.user().uid).toBe('other');
    expect(context.component.events()).toHaveLength(3);
    oldTable.eventsChange.emit({ userID: 'owner', updatedTags: { a: ['Private tag'] }, deletedEventIDs: ['b'] });
    expect(context.component.events().map(value => value.getID())).toEqual(['a', 'b', 'c']);
    expect(context.component.events()[0].tags).toEqual(['endurance']);
    expect(context.component.library().map(tag => tag.name)).not.toContain('Private tag');
  });

  it('retries catalog errors and refreshes from the newest page without changing the selected tag', async () => {
    const context = await setup('Recovery');
    context.catalog.listAllTags.mockRejectedValueOnce(new Error('offline'));
    await render(context);
    expect(context.component.catalogError()).toBe(true);
    expect(context.component.library().find(tag => tag.name === 'Recovery')?.count).toBe(1);
    context.component.retryCatalog();
    await render(context);
    expect(context.catalog.listAllTags).toHaveBeenLastCalledWith('owner', true);
    expect(context.component.catalogError()).toBe(false);
    context.component.refresh();
    await render(context);
    expect(context.events.getEventsPageOnceByWithMeta).toHaveBeenLastCalledWith(context.user$.value, [], 'startDate', false, 250, { startAfterCursor: null, requireServer: true });
    expect(context.component.selectedTag()).toBe('Recovery');
    expect(context.haptics.selection).toHaveBeenCalledTimes(2);
  });
});
