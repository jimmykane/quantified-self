import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSelect, MatSelectChange } from '@angular/material/select';
import { DateAdapter } from '@angular/material/core';
import { MatDateRangeInput, MatDateRangePicker } from '@angular/material/datepicker';
import { OverlayContainer } from '@angular/cdk/overlay';
import { ActivatedRoute, Router, UrlTree, convertToParamMap } from '@angular/router';
import { By } from '@angular/platform-browser';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import dayjs, { type Dayjs } from 'dayjs';
import { ActivityTypes, DataActivityTypes, DataDeviceNames, DataDistance, EventImporterJSON, FileType, Privacy, DistanceUnits, User, type EventInterface } from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import type { AppEventInterface } from '@shared/app-event.interface';
import { AppEventSummary } from '@shared/event-summary';
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
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { ActivityFilterPickerComponent } from '../shared/activity-filter-picker/activity-filter-picker.component';

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
  @Input() hasLoadError: boolean;
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
    getEventSummariesBy: vi.fn().mockImplementation(() => of(records.map(record => ({ ...record })))),
    getEventsPageOnceByWithMeta: vi.fn(), getEventCountBy: vi.fn(), getEventCount: vi.fn(),
  };
  const catalog = { listAllTags: vi.fn().mockResolvedValue(['Endurance', 'Race day', 'Recovery']) };
  const haptics = { selection: vi.fn(), error: vi.fn() };
  const dialogs: { close: ReturnType<typeof vi.fn>; closed$: Subject<boolean | undefined> }[] = [];
  const dialog = { open: vi.fn().mockImplementation(() => {
    const closed$ = new Subject<boolean | undefined>();
    const ref = { close: vi.fn((value?: boolean) => { closed$.next(value); closed$.complete(); }), afterClosed: () => closed$ };
    dialogs.push({ close: ref.close, closed$ });
    return ref;
  }) };
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
      { provide: AppEventColorService, useValue: { getColorForActivityTypeByActivityTypeGroup: () => '#123456', getGradientForActivityTypeGroup: () => 'none' } },
      ...(realTable ? [
        { provide: AppUserService, useValue: userService },
        ...[AppEventMergeService, AppEventReprocessService, AppEventSharingService, CalendarDayDetailsNavigationService, AppFileService, AppOriginalFileDownloadService,
          AppProcessingService, AppBenchmarkFlowService, AppAnalyticsService, EventTagService]
          .map(provide => ({ provide, useValue: {} })),
      ] : []),
    ],
  });
  TestBed.overrideComponent(ActivitiesPageComponent, { add: { providers: [{ provide: MatDialog, useValue: dialog }] } });
  if (!realTable) TestBed.overrideComponent(ActivitiesPageComponent, { remove: { imports: [EventTableModule] }, add: { imports: [EventTableStub] } });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(ActivitiesPageComponent);
  return { fixture, component: fixture.componentInstance, auth, user$, authState$, params$, events, catalog, haptics, router, userService, dialog, dialogs };
}
async function render(context: Awaited<ReturnType<typeof setup>>) {
  context.fixture.detectChanges();
  await context.fixture.whenStable();
  await vi.waitFor(() => {
    expect(context.component.loading()).toBe(false);
    expect(context.component.catalogLoading()).toBe(false);
  });
  context.fixture.detectChanges();
}

describe('ActivitiesPageComponent', () => {
  it('uses Dashboard’s full-range query with bounded numeric dates by default', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 12));
    try {
      const c = await setup();
      const data = records.map(record => ({ ...record, startDate: new Date(2026, 9, 21) }));
      c.events.getEventSummariesBy.mockReturnValue(of(data)); await render(c);
      expect(c.events.getEventSummariesBy).toHaveBeenCalledExactlyOnceWith(c.user$.value, [
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
    c.component.selectTags(['ENDURANCE']); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['a', 'b']);
    c.component.selectSports(['Ride']); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['b']);
    c.component.selectSports(['Cycling']); c.component.selectTags(['endurance']);
    expect(c.haptics.selection).toHaveBeenCalledTimes(2);
    c.component.clearFilters(); await render(c);
    expect(c.component.period()).toBe('month'); expect(c.component.filteredEvents()).toHaveLength(3);
    c.component.selectTags([], true); await render(c);
    expect(c.component.filteredEvents()).toEqual([]);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    expect(c.catalog.listAllTags).toHaveBeenCalledOnce();
  });

  it('combines searchable tag and sport checkbox selections locally and removes each filter independently', async () => {
    const c = await setup();
    c.events.getEventSummariesBy.mockReturnValue(of([...records, event('no-tag', [])])); await render(c);
    const pickers = c.fixture.debugElement.queryAll(By.directive(ActivityFilterPickerComponent))
      .map(element => element.componentInstance as ActivityFilterPickerComponent);
    const tags = pickers.find(picker => picker.label() === 'Tags')!;
    const sports = pickers.find(picker => picker.label() === 'Sports')!;
    sports.selectionChange.emit(['Run', 'Ride']); await render(c);
    expect(c.component.selectedSports()).toEqual(['Cycling', 'Running']);
    tags.selectionChange.emit(['tag:endurance', 'untagged']); await render(c);
    expect(c.component.filteredEvents().map(record => record.getID())).toEqual(['a', 'b', 'no-tag']);
    expect(c.router.navigate.mock.lastCall[1].queryParams).toMatchObject({
      tag: ['Endurance'], untagged: '1', sport: ['Cycling', 'Running'],
    });
    expect(c.fixture.nativeElement.querySelectorAll('mat-chip')).toHaveLength(4);
    c.component.removeTag('Endurance'); await render(c);
    expect(c.component.filteredEvents().map(record => record.getID())).toEqual(['no-tag']);
    c.component.removeSport('Running'); await render(c);
    expect(c.component.filteredEvents()).toEqual([]);
    c.component.clearFilters(); await render(c);
    expect(tags.summary()).toBe('All tags'); expect(sports.summary()).toBe('All sports');
    expect(c.component.filteredEvents()).toHaveLength(4);
    expect(c.haptics.selection).toHaveBeenCalledTimes(5);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce(); expect(c.catalog.listAllTags).toHaveBeenCalledOnce();
    expect(c.events.getEventCount).not.toHaveBeenCalled(); expect(c.events.getEventCountBy).not.toHaveBeenCalled();
    expect(c.events.getEventsPageOnceByWithMeta).not.toHaveBeenCalled();
  });

  it('hydrates repeated tag and sport URL parameters silently and retains selected choices absent from the range', async () => {
    const c = await setup();
    c.params$.next(convertToParamMap({ tag: ['ENDURANCE', 'Recovery', 'endurance'], sport: ['run', 'Running', 'Ride'] })); await render(c);
    expect(c.component.selectedTags()).toEqual(['ENDURANCE', 'Recovery']);
    expect(c.component.selectedTagNames()).toEqual(['Endurance', 'Recovery']);
    expect(c.component.selectedSports()).toEqual(['Cycling', 'Running']);
    expect(c.component.filteredEvents()).toHaveLength(3);
    c.params$.next(convertToParamMap({ tag: ['Missing saved', 'Recovery'], sport: ['Rowing', 'Run'] })); await render(c);
    expect(c.component.tagOptions().some(option => option.value === 'tag:missing saved')).toBe(true);
    expect(c.component.sports()).toContain('Rowing');
    c.component.selectSports(['Running', 'Rowing', 'Run']);
    c.component.selectTags(['recovery', 'missing saved']); await render(c);
    expect(c.haptics.selection).not.toHaveBeenCalled(); expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
  });

  it('applies one bounded custom range only after submitting both dates, with inclusive results', async () => {
    const c = await setup(); await render(c);
    c.component.selectPeriod('custom'); await render(c);
    expect(c.component.period()).toBe('month'); expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    expect(c.fixture.nativeElement.querySelector('mat-select[aria-label="Date range"]')).toBeNull();
    const labels = Array.from(c.fixture.nativeElement.querySelectorAll('.activity-explorer-filters mat-label')) as HTMLElement[];
    expect(labels.map(label => label.textContent)).toEqual(['Tags', 'Custom dates', 'Sports']);
    expect(c.fixture.nativeElement.querySelector('form')).toBeNull();
    c.component.customDateForm.setValue({ start: dayjs('2026-09-03'), end: null }); await render(c);
    c.component.applyCustomRange(); expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    c.component.customDateForm.setValue({ start: dayjs('2026-09-03'), end: dayjs('2026-09-04') }); await render(c);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce(); expect(c.haptics.selection).toHaveBeenCalledOnce();
    const data = [
      { ...event('before', []), startDate: new Date(2026, 8, 2, 23, 59, 59, 999) },
      { ...event('first', []), startDate: new Date(2026, 8, 3) },
      { ...event('last', []), startDate: new Date(2026, 8, 4, 23, 59, 59, 999) },
      { ...event('after', []), startDate: new Date(2026, 8, 5) },
    ];
    c.events.getEventSummariesBy.mockReturnValue(of(data));
    c.fixture.nativeElement.querySelector('input[aria-label="End date"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await render(c);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    expect(c.events.getEventSummariesBy).toHaveBeenLastCalledWith(c.user$.value, [
      { fieldPath: 'startDate', opStr: '>=', value: new Date(2026, 8, 3).getTime() },
      { fieldPath: 'startDate', opStr: '<', value: new Date(2026, 8, 5).getTime() },
    ], 'startDate', false, 0);
    expect(c.component.filteredEvents().map(event => event.getID())).toEqual(['first', 'last']);
    expect(c.router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({
      queryParams: expect.objectContaining({ period: 'custom', start: '2026-09-03', end: '2026-09-04' }),
    }));
    expect(c.haptics.selection).toHaveBeenCalledTimes(2);
    c.component.applyCustomRange(); c.component.selectPeriod('custom'); await render(c);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2); expect(c.haptics.selection).toHaveBeenCalledTimes(2);
    expect(c.events.getEventCountBy).not.toHaveBeenCalled(); expect(c.events.getEventCount).not.toHaveBeenCalled();
    expect(c.events.getEventsPageOnceByWithMeta).not.toHaveBeenCalled();
  });

  it('validates typed custom dates without queries or typing feedback and cancels without changing the range', async () => {
    const c = await setup(); await render(c); c.component.selectPeriod('custom'); await render(c);
    const range = c.fixture.debugElement.query(By.directive(MatDateRangeInput));
    const adapter = range.injector.get(DateAdapter) as DateAdapter<Dayjs>;
    const type = (label: string, value: string) => {
      const input = c.fixture.nativeElement.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur'));
    };
    type('Start date', adapter.format(dayjs('2026-09-03'), 'L'));
    type('End date', 'invalid'); await render(c);
    expect(c.component.customDateForm.invalid).toBe(true);
    expect(c.fixture.nativeElement.querySelector('mat-error').textContent).toContain('Enter valid dates');
    type('End date', adapter.format(dayjs('2026-09-02'), 'L')); await render(c);
    c.component.applyCustomRange(); expect(c.component.customDateForm.hasError('dateOrder')).toBe(true);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce(); expect(c.haptics.selection).toHaveBeenCalledOnce();
    c.component.cancelCustomRange(); await render(c);
    expect(c.component.period()).toBe('month'); expect(c.component.showCustomRange()).toBe(false);
    expect(c.fixture.nativeElement.querySelector('mat-select[aria-label="Date range"]').textContent.trim()).toBe('Last 30 days');
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce(); expect(c.haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('supports selecting both dates in the calendar without a query until Apply', async () => {
    const c = await setup(); await render(c); c.component.selectPeriod('custom'); await render(c);
    c.component.customDateForm.reset({ start: null, end: null });
    const picker = c.fixture.debugElement.query(By.directive(MatDateRangePicker)).componentInstance as MatDateRangePicker<Dayjs>;
    picker.startAt = dayjs('2026-09-01');
    const adapter = c.fixture.debugElement.query(By.directive(MatDateRangeInput)).injector.get(DateAdapter) as DateAdapter<Dayjs>;
    c.fixture.nativeElement.querySelector('input[aria-label="Start date"]').click(); await render(c);
    expect(c.haptics.selection).toHaveBeenCalledTimes(2);
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    expect(overlay.querySelector('mat-calendar')).not.toBeNull();
    const clickDate = (date: string) => {
      const label = adapter.format(dayjs(date), 'LL');
      const cell = Array.from(overlay.querySelectorAll<HTMLElement>('[aria-label]')).find(element => element.getAttribute('aria-label') === label);
      expect(cell, `Calendar date ${label}`).toBeDefined(); cell!.click();
    };
    clickDate('2026-09-03'); await render(c);
    expect(c.component.customDateForm.controls.start.value).toBeNull();
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    clickDate('2026-09-04'); await render(c);
    expect(c.component.customDateForm.controls.end.value).toBeNull();
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    const apply = overlay.querySelector('button[matDateRangePickerApply]') as HTMLButtonElement;
    expect(apply.disabled).toBe(false); apply.click(); await render(c);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    expect(c.component.customDateForm.controls.start.value?.format('YYYY-MM-DD')).toBe('2026-09-03');
    expect(c.component.customDateForm.controls.end.value?.format('YYYY-MM-DD')).toBe('2026-09-04');
    expect(c.events.getEventSummariesBy.mock.lastCall[1][1].value).toBe(new Date(2026, 8, 5).getTime());
    expect(c.haptics.selection).toHaveBeenCalledTimes(3);

    // Calendar actions keep their pending model separate from the applied field.
    c.fixture.nativeElement.querySelector('mat-datepicker-toggle button').click(); await render(c);
    clickDate('2026-09-10'); await render(c);
    clickDate('2026-09-11'); await render(c);
    expect(c.component.customDateForm.controls.start.value?.format('YYYY-MM-DD')).toBe('2026-09-03');
    overlay.querySelector<HTMLButtonElement>('button[matDateRangePickerCancel]')!.click(); await render(c);
    expect(c.component.customDateForm.controls.end.value?.format('YYYY-MM-DD')).toBe('2026-09-04');
    expect(c.component.showCustomRange()).toBe(true);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    expect(c.haptics.selection).toHaveBeenCalledTimes(5);
  });

  it('clears custom dates back to presets without loading pending edits and preserves other filters', async () => {
    const c = await setup('Endurance'); await render(c);
    c.component.selectPeriod('week'); await render(c);
    c.component.selectPeriod('custom'); await render(c);
    const clear = () => c.fixture.nativeElement.querySelector('button[aria-label="Clear custom dates and show date presets"]').click();
    clear(); await render(c);
    expect(c.component.period()).toBe('week'); expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    expect(c.fixture.nativeElement.querySelector('mat-select[aria-label="Date range"]').textContent.trim()).toBe('Last 7 days');
    c.component.selectPeriod('custom'); await render(c);
    c.component.customDateForm.setValue({ start: dayjs('2026-09-03'), end: dayjs('2026-09-04') });
    c.component.applyCustomRange(); await render(c);
    expect(c.fixture.nativeElement.querySelector('input[aria-label="Start date"]').value).not.toBe('');
    expect(c.fixture.nativeElement.querySelector('input[aria-label="End date"]').value).not.toBe('');
    clear(); await render(c);
    expect(c.component.period()).toBe('month'); expect(c.component.selectedTags()).toEqual(['Endurance']);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(4);
    expect(c.events.getEventSummariesBy.mock.lastCall[1]).toHaveLength(2);
    expect(c.fixture.nativeElement.querySelector('mat-select[aria-label="Date range"]').textContent.trim()).toBe('Last 30 days');
    expect(c.router.navigate.mock.lastCall[1].queryParams).toMatchObject({ period: 'month', start: null, end: null });
  });

  it('keeps keyboard focus on the date control when entering, clearing or canceling a custom range', async () => {
    const c = await setup(); await render(c);
    const presets = c.fixture.nativeElement.querySelector('mat-select[aria-label="Date range"]') as HTMLElement;
    presets.focus(); presets.click(); await render(c);
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const customOption = Array.from(overlay.querySelectorAll<HTMLElement>('[role="option"]'))
      .find(option => option.textContent?.trim() === 'Custom dates')!;
    customOption.click(); await render(c);
    const start = c.fixture.nativeElement.querySelector('input[aria-label="Start date"]') as HTMLInputElement;
    expect(document.activeElement).toBe(start);
    start.focus(); start.click(); await render(c);
    const cancel = overlay.querySelector<HTMLButtonElement>('button[matDateRangePickerCancel]')!;
    cancel.focus(); cancel.click(); await render(c);
    expect(document.activeElement).toBe(c.fixture.nativeElement.querySelector('mat-select[aria-label="Date range"]'));
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();

    c.component.selectPeriod('custom'); await render(c);
    c.component.customDateForm.setValue({ start: dayjs('2026-09-03'), end: dayjs('2026-09-04') });
    c.component.applyCustomRange(); await render(c);
    const clear = c.fixture.nativeElement.querySelector('button[aria-label="Clear custom dates and show date presets"]') as HTMLButtonElement;
    clear.focus(); clear.click(); await render(c);
    expect(document.activeElement).toBe(c.fixture.nativeElement.querySelector('mat-select[aria-label="Date range"]'));
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(3);
    expect(c.events.getEventCountBy).not.toHaveBeenCalled();
    expect(c.events.getEventsPageOnceByWithMeta).not.toHaveBeenCalled();
  });

  it('hydrates saved custom dates silently and queries once when only their bounds change', async () => {
    const c = await setup('Endurance');
    const query = { tag: 'Endurance', period: 'custom', start: '2026-09-03', end: '2026-09-04' };
    c.params$.next(convertToParamMap(query)); await render(c);
    expect(c.component.period()).toBe('custom'); expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    expect(c.events.getEventSummariesBy.mock.lastCall[1]).toEqual([
      { fieldPath: 'startDate', opStr: '>=', value: new Date(2026, 8, 3).getTime() },
      { fieldPath: 'startDate', opStr: '<', value: new Date(2026, 8, 5).getTime() },
    ]);
    expect(c.component.customDateForm.controls.start.value?.format('YYYY-MM-DD')).toBe(query.start);
    c.params$.next(convertToParamMap(query)); await render(c); expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    c.params$.next(convertToParamMap({ ...query, end: '2026-09-05' })); await render(c);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    expect(c.events.getEventSummariesBy.mock.lastCall[1][1].value).toBe(new Date(2026, 8, 6).getTime());
    expect(c.haptics.selection).not.toHaveBeenCalled();
    c.component.customDateForm.controls.end.setValue(dayjs('2026-09-09')); c.component.customDateForm.markAsDirty();
    c.component.cancelCustomRange(); await render(c);
    expect(c.component.customDateForm.controls.end.value?.format('YYYY-MM-DD')).toBe('2026-09-05');
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    c.component.selectTags(['Race day']); await render(c);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    c.component.selectPeriod('week'); await render(c);
    expect(c.component.customDates()).toBeNull(); expect(c.component.showCustomRange()).toBe(false);
    expect(c.router.navigate.mock.lastCall[1].queryParams).toMatchObject({ period: 'week', start: null, end: null });
  });

  it.each([
    { period: 'custom' },
    { period: 'custom', start: '2026-10-02', end: '2026-10-01' },
    { period: 'custom', start: '2026-02-30', end: '2026-03-01' },
  ])('falls back to the bounded default for an invalid custom link: %j', async query => {
    const c = await setup(); c.params$.next(convertToParamMap(query)); await render(c);
    expect(c.component.period()).toBe('month'); expect(c.component.customDates()).toBeNull();
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce(); expect(c.events.getEventSummariesBy.mock.lastCall[1]).toHaveLength(2);
    expect(c.router.navigate.mock.lastCall[1]).toMatchObject({ replaceUrl: true, queryParams: { period: 'month', start: null, end: null } });
    expect(c.haptics.selection).not.toHaveBeenCalled();
  });

  it('keeps fixed custom bounds across midnight and does not discard unsubmitted edits on a tag URL update', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 21, 23, 59));
    try {
      const c = await setup();
      const query = { period: 'custom', start: '2026-10-01', end: '2026-10-21' };
      c.params$.next(convertToParamMap(query)); await render(c);
      c.component.customDateForm.controls.end.setValue(dayjs('2026-10-25')); c.component.customDateForm.markAsDirty();
      c.params$.next(convertToParamMap({ ...query, tag: 'Endurance' })); await render(c);
      expect(c.component.customDateForm.controls.end.value?.format('YYYY-MM-DD')).toBe('2026-10-25');
      vi.setSystemTime(new Date(2026, 9, 22, 0, 1)); c.component.refreshLocalDay(); await render(c);
      expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
      c.component.clearFilters(); await render(c);
      expect(c.component.period()).toBe('month'); expect(c.component.customDates()).toBeNull();
      expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('places All dates last and keeps the displayed range and query until confirmation', async () => {
    const c = await setup(); await render(c);
    const select = c.fixture.debugElement.queryAll(By.directive(MatSelect))
      .map(element => element.componentInstance as MatSelect).find(select => select.ariaLabel === 'Date range')!;
    expect(select.options.last.value).toBe('all');
    select.value = 'all';
    select.selectionChange.emit(new MatSelectChange(select, 'all')); await render(c);
    expect(select.value).toBe('month'); expect(c.component.period()).toBe('month');
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    expect(c.dialog.open).toHaveBeenCalledExactlyOnceWith(ConfirmationDialogComponent, {
      data: {
        title: 'Load all activity history?',
        message: expect.stringContaining('entire activity history'),
        confirmText: 'Load all activities', cancelText: 'Keep current range',
      },
    });
    expect(c.dialog.open.mock.lastCall[1].data.message).toContain('uses more data');
    c.component.selectPeriod('all'); expect(c.dialog.open).toHaveBeenCalledOnce();
    c.dialogs[0].close(true); await render(c);
    expect(select.value).toBe('all'); expect(c.component.period()).toBe('all');
    const dateField = c.fixture.nativeElement.querySelector('mat-select[aria-label="Date range"]');
    expect(dateField.textContent.trim()).toBe('All dates');
    // The shared dialog owns its confirmation button's feedback; do not repeat it here.
    expect(c.haptics.selection).toHaveBeenCalledOnce();
    expect(c.events.getEventSummariesBy).toHaveBeenLastCalledWith(c.user$.value, [], 'startDate', false, 0);
    c.params$.next(convertToParamMap({ period: 'all' })); await render(c);
    expect(c.dialog.open).toHaveBeenCalledOnce(); expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    c.component.selectTags(['Endurance']); await render(c);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    c.component.clearFilters(); await render(c);
    expect(c.component.period()).toBe('month');
    expect(c.events.getEventSummariesBy.mock.lastCall[1]).toHaveLength(2);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(3);
    c.component.clearFilters(); expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(3);
  });

  it.each([false, undefined])('keeps the current range without a query when All dates is dismissed with %s', async result => {
    const c = await setup(); await render(c);
    c.component.selectPeriod('week'); await render(c);
    c.component.selectPeriod('all'); c.dialogs[0].close(result); await render(c);
    expect(c.component.period()).toBe('week');
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    expect(c.events.getEventSummariesBy.mock.calls.every(call => call[1].length === 2)).toBe(true);
  });

  it('hydrates saved filters silently and only queries again when the date range changes', async () => {
    const c = await setup('Endurance'); await render(c);
    expect(c.component.filteredEvents()).toHaveLength(2);
    c.params$.next(convertToParamMap({ tag: 'Recovery', sport: 'Run', period: 'month' })); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['c']);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    c.params$.next(convertToParamMap({ untagged: '1', period: 'week' })); await render(c);
    expect(c.component.untagged()).toBe(true); expect(c.component.filteredEvents()).toEqual([]);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    expect(c.haptics.selection).not.toHaveBeenCalled();
  });

  it('warns for an initial All dates link before any activity query and safely falls back on cancel', async () => {
    const c = await setup(); c.params$.next(convertToParamMap({ tag: 'Endurance', period: 'all' })); await render(c);
    expect(c.dialog.open).toHaveBeenCalledOnce(); expect(c.events.getEventSummariesBy).not.toHaveBeenCalled();
    expect(c.haptics.selection).not.toHaveBeenCalled();
    c.dialogs[0].close(false); await render(c);
    expect(c.component.period()).toBe('month'); expect(c.component.selectedTags()).toEqual(['Endurance']);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce(); expect(c.events.getEventSummariesBy.mock.lastCall[1]).toHaveLength(2);
    expect(c.router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({
      queryParams: expect.objectContaining({ tag: ['Endurance'], period: 'month' }), replaceUrl: true,
    }));
    expect(c.haptics.selection).not.toHaveBeenCalled();
  });

  it('requires confirmation for browser navigation to All dates and does not requery on cancel', async () => {
    const c = await setup(); await render(c);
    c.params$.next(convertToParamMap({ period: 'all' })); await render(c);
    expect(c.component.period()).toBe('month'); expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    c.dialogs[0].close(false); await render(c);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    c.params$.next(convertToParamMap({ period: 'all' })); c.dialogs[1].close(true); await render(c);
    expect(c.component.period()).toBe('all');
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2); expect(c.events.getEventSummariesBy.mock.lastCall[1]).toEqual([]);
    expect(c.haptics.selection).not.toHaveBeenCalled();
  });

  it('closes a pending warning on date navigation, account changes and teardown', async () => {
    const c = await setup(); await render(c);
    c.component.selectPeriod('all');
    c.params$.next(convertToParamMap({ period: 'week' })); await render(c);
    expect(c.dialogs[0].close).toHaveBeenCalledExactlyOnceWith(false);
    c.dialogs[0].closed$.next(true); expect(c.component.period()).toBe('week');
    c.component.selectPeriod('all');
    c.auth.currentUser = { uid: 'owner' }; c.authState$.next(c.auth.currentUser); await render(c);
    expect(c.dialogs[1].close).toHaveBeenCalledExactlyOnceWith(false);
    c.component.selectPeriod('all'); c.fixture.destroy();
    expect(c.dialogs[2].close).toHaveBeenCalledExactlyOnceWith(false);
    expect(c.events.getEventSummariesBy.mock.calls.every(call => call[1].length === 2)).toBe(true);
  });

  it('does not reuse full-history confirmation after the signed-in session changes', async () => {
    const c = await setup(); await render(c);
    c.component.selectPeriod('all'); c.dialogs[0].close(true); await render(c);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    c.auth.currentUser = { uid: 'owner' }; c.authState$.next(c.auth.currentUser); await render(c);
    expect(c.component.period()).toBe('month'); expect(c.dialog.open).toHaveBeenCalledTimes(2);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    c.dialogs[1].close(false); await render(c);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(3);
    expect(c.events.getEventSummariesBy.mock.lastCall[1]).toHaveLength(2);
  });

  it('keeps literal tag names separate from the Untagged option', async () => {
    const c = await setup();
    c.events.getEventSummariesBy.mockReturnValue(of([event('empty', []), event('named', ['__none', 'untagged'])])); await render(c);
    c.component.selectTags([], true); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['empty']);
    c.component.selectTags(['__none']); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['named']);
    c.component.selectTagFilters(['untagged']); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['empty']);
    c.component.selectTagFilters(['tag:untagged']); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['named']);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
  });

  it('matches canonical sport aliases and excludes generated comparisons from the table', async () => {
    const c = await setup();
    c.events.getEventSummariesBy.mockReturnValue(of([
      { ...event('run', []), getActivityTypesAsArray: () => ['Run'] },
      { ...event('running', []), getActivityTypesAsArray: () => ['Running'] },
      { ...event('comparison', []), isMerge: true },
      { ...event('benchmark', []), hasBenchmark: true },
    ]));
    c.params$.next(convertToParamMap({ sport: 'run' })); await render(c);
    expect(c.component.selectedSports()).toEqual(['Running']); expect(c.component.filteredEvents()).toHaveLength(2);
    expect(c.component.sports()).toContain('Cycling');
    c.component.selectSports(['Run']); expect(c.haptics.selection).not.toHaveBeenCalled();
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
  });

  it('toggles loaded merged rows locally, preserves other filters and restores URL choices silently', async () => {
    const c = await setup();
    c.events.getEventSummariesBy.mockReturnValue(of([
      event('run', ['Endurance']),
      { ...event('merged', ['Endurance']), isMerge: true },
      { ...event('benchmark', ['Endurance']), hasBenchmark: true },
    ]));
    await render(c);
    const toggle = c.fixture.debugElement.query(By.css('app-merged-activities-toggle'));
    expect(toggle).toBeTruthy();
    c.component.selectTags(['Endurance']);
    c.haptics.selection.mockClear();
    toggle.componentInstance.checkedChange.emit(true);
    await render(c);
    expect(c.component.filteredEvents().map(record => record.getID())).toEqual(['run', 'merged']);
    expect(c.component.selectedTags()).toEqual(['Endurance']);
    expect(c.router.navigate.mock.lastCall[1].queryParams.merged).toBe('1');
    expect(c.haptics.selection).toHaveBeenCalledTimes(1);
    c.component.selectMergedEvents(true);
    expect(c.haptics.selection).toHaveBeenCalledTimes(1);
    c.component.selectMergedEvents(false);
    expect(c.component.filteredEvents().map(record => record.getID())).toEqual(['run']);
    c.haptics.selection.mockClear();
    c.params$.next(convertToParamMap({ merged: '1' })); await render(c);
    expect(c.component.includeMergedEvents()).toBe(true);
    expect(c.haptics.selection).not.toHaveBeenCalled();
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    expect(c.events.getEventCountBy).not.toHaveBeenCalled();
    expect(c.events.getEventsPageOnceByWithMeta).not.toHaveBeenCalled();
  });

  it('uses one live listener for subsequent activity updates without repeating the query', async () => {
    const c = await setup(); const live = new Subject<AppEventInterface[]>();
    c.events.getEventSummariesBy.mockReturnValue(live); c.fixture.detectChanges();
    expect(c.component.loading()).toBe(true);
    live.next(records); await render(c);
    live.next([...records, event('new', [])]); await render(c);
    expect(c.component.events()).toHaveLength(4); expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    expect(c.haptics.selection).not.toHaveBeenCalled(); expect(c.haptics.error).not.toHaveBeenCalled();
  });

  it('cancels the previous listener on range changes, account changes and teardown', async () => {
    const c = await setup(); const first = new Subject<AppEventInterface[]>();
    const session = new Subject<AppEventInterface[]>();
    c.events.getEventSummariesBy.mockReturnValueOnce(first); c.fixture.detectChanges();
    expect(first.observed).toBe(true);
    c.component.selectPeriod('year'); await render(c); expect(first.observed).toBe(false);
    first.next([event('old-range', ['Private'])]); expect(c.component.events()).toEqual(records);
    c.events.getEventSummariesBy.mockReturnValueOnce(session); c.component.refresh();
    c.auth.currentUser = { uid: 'owner' }; c.authState$.next(c.auth.currentUser); await render(c);
    expect(session.observed).toBe(false);
    session.next([event('old-owner', ['Private'])]); expect(c.component.events()).toEqual(records);
    const last = new Subject<AppEventInterface[]>(); c.events.getEventSummariesBy.mockReturnValueOnce(last); c.component.refresh();
    expect(last.observed).toBe(true); c.fixture.destroy(); expect(last.observed).toBe(false);
    last.next([event('destroyed', [])]); expect(c.component.events()).toEqual([]);
  });

  it('retries a failed range query with one action feedback and only reports explicit failures', async () => {
    const c = await setup();
    c.events.getEventSummariesBy.mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(throwError(() => new Error('still offline')));
    await render(c); expect(c.component.historyError()).toBe(true);
    expect(c.haptics.error).not.toHaveBeenCalled();
    c.component.retryActivities(); await render(c);
    expect(c.haptics.selection).toHaveBeenCalledOnce(); expect(c.haptics.error).toHaveBeenCalledOnce();
    c.component.retryActivities(); await render(c);
    expect(c.component.events()).toEqual(records); expect(c.component.historyError()).toBe(false);
    const reads = c.events.getEventSummariesBy.mock.calls.length;
    c.component.retryActivities(); expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(reads);
  });

  it('applies confirmed edits and deletions without restarting the live query', async () => {
    const c = await setup('Endurance'); await render(c);
    c.component.onEventsChange({ userID: 'owner', updatedTags: { b: ['New label'] }, deletedEventIDs: ['a'] }); await render(c);
    expect(c.component.filteredEvents()).toEqual([]);
    expect(c.component.library().map(t => t.name)).toContain('New label');
    c.component.selectTags(['New label']); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['b']);
    expect(c.component.filteredEvents()[0].benchmarkReviewTags).toBeUndefined();
    c.component.onEventsChange({ userID: 'owner', updatedTags: { b: [] }, deletedEventIDs: [] });
    c.component.selectTags([], true); await render(c);
    expect(c.component.filteredEvents().map(e => e.getID())).toEqual(['b']);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
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
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
  });

  it('retries tag catalog errors without refetching activities', async () => {
    const c = await setup(); c.catalog.listAllTags.mockRejectedValueOnce(new Error('offline')); await render(c);
    expect(c.component.catalogError()).toBe(true); c.component.retryCatalog(); await render(c);
    expect(c.catalog.listAllTags).toHaveBeenLastCalledWith('owner', true);
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
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
      expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
      expect(c.events.getEventSummariesBy.mock.lastCall[1]).toEqual([
        { fieldPath: 'startDate', opStr: '>=', value: new Date(2026, 9, 16).getTime() },
        { fieldPath: 'startDate', opStr: '<', value: new Date(2026, 9, 23).getTime() },
      ]);
      expect(c.haptics.selection).not.toHaveBeenCalled();
      c.fixture.destroy(); await vi.advanceTimersByTimeAsync(60_000); expect(clock).toHaveBeenCalledOnce();
    } finally { c.fixture.destroy(); vi.useRealTimers(); }
  });

  it('shows the compact notice only for ready empty results and opens existing date controls without queries or duplicate feedback', async () => {
    const c = await setup('', true);
    const stream = new Subject<AppEventInterface[]>();
    c.events.getEventSummariesBy.mockReturnValue(stream);
    const settle = async () => { c.fixture.detectChanges(); await c.fixture.whenStable(); c.fixture.detectChanges(); };
    await settle();
    const root = c.fixture.nativeElement as HTMLElement;
    expect(c.component.loading()).toBe(true); expect(root.querySelector('.activity-table-empty')).toBeNull();
    stream.next([]); await render(c);
    const table = c.fixture.debugElement.query(By.directive(EventTableComponent)).componentInstance as EventTableComponent;
    const paginator = table.paginator, sort = table.sort, columns = [...table.selectedColumns];
    expect(root.querySelector('.activity-table-empty-copy')?.textContent).toContain('No activities in this date range');
    expect(root.querySelector('.activity-table-empty-copy p')?.textContent).toBe('Try a wider date range.');
    expect(root.querySelector('.event-table-header app-data-type-icon')).not.toBeNull();
    expect(root.querySelector('.qs-glass-card-panel')).not.toBeNull();
    expect(root.querySelector<HTMLElement>('mat-paginator')?.hidden).toBe(true);
    expect(c.haptics.selection).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('[event-table-empty-action]')!.click(); await settle();
    const presets = c.fixture.debugElement.query(By.directive(MatSelect)).componentInstance as MatSelect;
    expect(presets.panelOpen).toBe(true); expect(c.haptics.selection).toHaveBeenCalledOnce();
    c.component.openDateFilter(); expect(c.haptics.selection).toHaveBeenCalledOnce();
    presets.close(); await settle();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Date range');
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    c.component.selectPeriod('custom'); await settle(); c.haptics.selection.mockClear();
    root.querySelector<HTMLButtonElement>('[event-table-empty-action]')!.click(); await settle();
    const picker = c.fixture.debugElement.query(By.directive(MatDateRangePicker)).componentInstance as MatDateRangePicker<Dayjs>;
    expect(picker.opened).toBe(true); expect(c.haptics.selection).toHaveBeenCalledOnce();
    c.component.openDateFilter(); await settle(); expect(c.haptics.selection).toHaveBeenCalledOnce();
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce(); picker.close(); await settle();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Start date');
    c.component.cancelCustomRange(); await settle();
    const record = EventImporterJSON.getEventFromJSON({ name: 'Sample ride', startDate: Date.now(), endDate: Date.now(),
      srcFileType: FileType.FIT, privacy: Privacy.Private, stats: {}, activities: [] }) as AppEventInterface;
    record.setID('empty-notice-example'); record.addStat(new DataActivityTypes([ActivityTypes.Cycling]));
    record.addStat(new DataDeviceNames([])); record.addStat(new DataDistance(1000));
    stream.next([record]); await render(c);
    expect(root.querySelector('.activity-table-empty')).toBeNull();
    expect(root.querySelector<HTMLElement>('mat-paginator')?.hidden).toBe(false);
    expect(table.paginator).toBe(paginator); expect(table.sort).toBe(sort); expect(table.selectedColumns).toEqual(columns);
    table.search('not recorded'); await settle();
    expect(root.querySelector('.activity-table-empty-copy')?.textContent).toContain('No activities match your filters');
    expect(root.querySelector('.activity-table-empty-copy p')?.textContent).toBe('Change your dates or clear a filter.');
    table.clearSearch(); await settle();
    expect(root.querySelector('.activity-table-empty')).toBeNull();
    stream.next([]); await render(c);
    expect(root.querySelector('.activity-table-empty-copy p')?.textContent).toBe('Try a wider date range.');
    c.component.refresh(); await settle();
    expect(c.component.loading()).toBe(true); expect(root.querySelector('.activity-table-empty')).toBeNull();
    stream.error(new Error('unavailable')); await settle();
    expect(c.component.historyError()).toBe(true); expect(root.querySelector('.activity-table-empty')).toBeNull();
    expect(c.userService.updateUserProperties).not.toHaveBeenCalled();
    c.fixture.destroy();
  });

  it('keeps empty-result hints specific to date ranges and filters, including All dates', async () => {
    const c = await setup();
    c.events.getEventSummariesBy.mockReturnValue(of([])); await render(c);
    const table = () => c.fixture.debugElement.query(By.directive(EventTableStub)).componentInstance as EventTableStub;
    expect(table().emptyHint).toBe('Try a wider date range.');
    c.component.selectPeriod('year'); await render(c);
    expect(table().emptyHint).toBe('Try a wider date range.');
    c.component.selectTags(['Recovery']); await render(c);
    expect(table().emptyMessage).toBe('No activities with this tag');
    expect(table().emptyHint).toBe('Change your dates or clear a filter.');
    c.component.selectTags([]); c.component.selectPeriod('all');
    c.dialogs.at(-1)!.closed$.next(true); await render(c);
    expect(table().emptyMessage).toBe('No activities to show'); expect(table().emptyHint).toBe('');
    c.component.selectSports(['Cycling']); await render(c);
    expect(table().emptyMessage).toBe('No activities match these filters');
    expect(table().emptyHint).toBe('Change your dates or clear a filter.');
    expect(c.userService.updateUserProperties).not.toHaveBeenCalled();
  });

  it.each([false, true])('defaults to newest-first dates across year boundaries and retains an explicit ascending choice (%s)', async (ascending) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 0, 2, 12));
    try {
      const c = await setup('', true);
      const settings = c.user$.value.settings.dashboardSettings.tableSettings;
      delete settings.active; delete settings.direction;
      if (ascending) { settings.active = 'Start Date'; settings.direction = 'asc'; }
      const summary = (name: string, date: Date) => new AppEventSummary({
        id: name, name, startDate: +date, endDate: +date + 60_000, srcFileType: FileType.FIT,
        privacy: Privacy.Private, description: null, isMerge: false,
        stats: { 'Activity Types': [ActivityTypes.Cycling], 'Device Names': [], Distance: 1000 },
      });
      const data = [summary('Oldest ride', new Date(2026, 11, 6)), summary('Newest ride', new Date(2027, 0, 1)), summary('Middle ride', new Date(2026, 11, 31))];
      const updates$ = new BehaviorSubject(data);
      c.events.getEventSummariesBy.mockReturnValue(updates$); await render(c);
      const table = c.fixture.debugElement.query(By.directive(EventTableComponent)).componentInstance as EventTableComponent;
      const names = () => [...c.fixture.nativeElement.querySelectorAll('tr.activity-row .activity-custom-name')]
        .map((node: HTMLElement) => node.textContent?.trim());
      expect(table.sort.active).toBe('Start Date'); expect(table.sort.direction).toBe(ascending ? 'asc' : 'desc');
      const expected = ['Newest ride', 'Middle ride', 'Oldest ride'];
      expect(names()).toEqual(ascending ? [...expected].reverse() : expected);
      updates$.next([...data, summary('Latest arrival', new Date(2027, 0, 2, 10))]); await render(c);
      expect(names()).toEqual(ascending ? [...expected].reverse().concat('Latest arrival') : ['Latest arrival', ...expected]);
      expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
      expect(c.userService.updateUserProperties).not.toHaveBeenCalled(); expect(c.haptics.selection).not.toHaveBeenCalled();
      c.fixture.destroy();
    } finally { vi.useRealTimers(); }
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
    c.events.getEventSummariesBy.mockReturnValue(of(data)); await render(c);
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
    c.component.selectTags(['Endurance']); await render(c);
    expect(c.fixture.nativeElement.querySelector('mat-paginator').textContent).toContain('1 – 6 of 6');
    c.component.clearFilters(); await render(c);
    const columns = c.fixture.debugElement.query(By.directive(EventTableActionsComponent)).componentInstance as EventTableActionsComponent;
    columns.selectedDataTypesChange.emit(['Duration', 'Distance']); await render(c);
    expect(c.userService.updateUserProperties).toHaveBeenCalled();
    expect(c.events.getEventSummariesBy).toHaveBeenCalledOnce();
    expect(c.events.getEventsPageOnceByWithMeta).not.toHaveBeenCalled();
    expect(c.events.getEventCountBy).not.toHaveBeenCalled(); expect(c.events.getEventCount).not.toHaveBeenCalled();
  });

  it('does not duplicate a date query when a range is changed after midnight or its URL is updated', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 21, 23, 59));
    try {
      const c = await setup(); await render(c);
      vi.setSystemTime(new Date(2026, 9, 22, 0, 1));
      c.component.selectPeriod('week'); await render(c);
      expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
      expect(c.events.getEventSummariesBy.mock.lastCall[1]).toEqual([
        { fieldPath: 'startDate', opStr: '>=', value: new Date(2026, 9, 16).getTime() },
        { fieldPath: 'startDate', opStr: '<', value: new Date(2026, 9, 23).getTime() },
      ]);
      c.params$.next(convertToParamMap({ tag: 'Endurance', period: 'week' })); await render(c);
      expect(c.events.getEventSummariesBy).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});

describe('Activity filter picker Material integration', () => {
  it('searches single choices, replaces the selection, closes and restores keyboard focus without bulk actions', async () => {
    const haptics = { selection: vi.fn() };
    TestBed.configureTestingModule({ imports: [ActivityFilterPickerComponent, NoopAnimationsModule], providers: [
      { provide: AppHapticsService, useValue: haptics },
      { provide: AppEventColorService, useValue: { getColorForActivityTypeByActivityTypeGroup: () => '#123456' } },
    ] });
    const fixture = TestBed.createComponent(ActivityFilterPickerComponent);
    fixture.componentRef.setInput('label', 'Sport'); fixture.componentRef.setInput('allLabel', 'Choose sport');
    fixture.componentRef.setInput('searchLabel', 'Search sports'); fixture.componentRef.setInput('multiple', false);
    fixture.componentRef.setInput('options', ['Running', 'Cycling'].map(value => ({ value, label: value, activityType: value })));
    fixture.componentRef.setInput('shortcuts', [{ label: 'All sports', values: ['Running', 'Cycling'] }]);
    fixture.componentRef.setInput('selectedValues', ['Cycling']);
    const selected = vi.fn((values: string[]) => fixture.componentRef.setInput('selectedValues', values));
    fixture.componentInstance.selectionChange.subscribe(selected);
    const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    await settle();
    expect(haptics.selection).not.toHaveBeenCalled();
    const trigger = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    expect(overlay.querySelector('mat-selection-list')?.getAttribute('aria-multiselectable')).toBe('false');
    expect(overlay.querySelector('mat-checkbox')).toBeNull();
    expect(overlay.textContent).not.toContain('Clear selection');
    fixture.componentInstance.clearSelection(); fixture.componentInstance.toggleShortcut({ label: 'All', values: ['Running'] }, true);
    expect(selected).not.toHaveBeenCalled();
    const search = overlay.querySelector<HTMLInputElement>('input[aria-label="Search sports"]')!;
    search.value = 'run'; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(overlay.querySelectorAll('mat-list-option')).toHaveLength(1);
    overlay.querySelector<HTMLElement>('mat-list-option[aria-label="Running"]')!.click(); await settle();
    expect(selected).toHaveBeenCalledExactlyOnceWith(['Running']);
    expect(trigger.value).toBe('Running'); expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(haptics.selection).toHaveBeenCalledOnce(); // The caller owns accepted-selection feedback.
  });

  it('shows partial sport families and changes only that family when its checkbox is toggled', async () => {
    TestBed.configureTestingModule({
      imports: [ActivityFilterPickerComponent, NoopAnimationsModule],
      providers: [
        { provide: AppHapticsService, useValue: { selection: vi.fn() } },
        { provide: AppEventColorService, useValue: { getColorForActivityTypeByActivityTypeGroup: () => '#123456' } },
      ],
    });
    const fixture = TestBed.createComponent(ActivityFilterPickerComponent);
    fixture.componentRef.setInput('label', 'Sports');
    fixture.componentRef.setInput('allLabel', 'All sports');
    fixture.componentRef.setInput('searchLabel', 'Search sports');
    fixture.componentRef.setInput('options', ['Running', 'Trail Running', 'Cycling'].map(value => ({ value, label: value, activityType: value })));
    fixture.componentRef.setInput('shortcuts', [{ label: 'All Running / Trail', values: ['Running', 'Trail Running'] }]);
    fixture.componentRef.setInput('selectedValues', ['Cycling', 'Running']);
    const selected = vi.fn((values: string[]) => fixture.componentRef.setInput('selectedValues', values));
    fixture.componentInstance.selectionChange.subscribe(selected);
    const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    await settle(); fixture.componentInstance.openPicker(); await settle();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const checkbox = overlay.querySelector<HTMLInputElement>('mat-checkbox input')!;
    expect(checkbox.indeterminate).toBe(true);
    checkbox.click(); await settle();
    expect(selected).toHaveBeenLastCalledWith(['Cycling', 'Running', 'Trail Running']);
    expect(checkbox.checked).toBe(true); expect(checkbox.indeterminate).toBe(false);
    checkbox.click(); await settle();
    expect(selected).toHaveBeenLastCalledWith(['Cycling']);
    fixture.componentInstance.closePicker(); await settle();
  });

  it('searches checkbox choices with sport icons and preserves selected choices hidden by search', async () => {
    const haptics = { selection: vi.fn() };
    TestBed.configureTestingModule({
      imports: [ActivityFilterPickerComponent, NoopAnimationsModule],
      providers: [
        { provide: AppHapticsService, useValue: haptics },
        { provide: AppEventColorService, useValue: { getColorForActivityTypeByActivityTypeGroup: () => '#123456' } },
      ],
    });
    const fixture = TestBed.createComponent(ActivityFilterPickerComponent);
    fixture.componentRef.setInput('label', 'Sports');
    fixture.componentRef.setInput('allLabel', 'All sports');
    fixture.componentRef.setInput('searchLabel', 'Search sports');
    fixture.componentRef.setInput('options', [
      { value: 'Running', label: 'Running', activityType: 'Running' },
      { value: 'Cycling', label: 'Cycling', activityType: 'Cycling' },
    ]);
    fixture.componentRef.setInput('selectedValues', ['Cycling']);
    const selected = vi.fn((values: string[]) => fixture.componentRef.setInput('selectedValues', values));
    fixture.componentInstance.selectionChange.subscribe(selected);
    const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    await settle();
    const trigger = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    expect(overlay.querySelectorAll('app-activity-type-icon')).toHaveLength(2);
    expect(overlay.querySelector('[aria-label="Cycling"]')?.getAttribute('aria-selected')).toBe('true');
    const search = overlay.querySelector<HTMLInputElement>('input[aria-label="Search sports"]')!;
    search.value = 'run'; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(overlay.querySelectorAll('mat-list-option')).toHaveLength(1);
    expect(haptics.selection).toHaveBeenCalledOnce();
    overlay.querySelector<HTMLElement>('mat-list-option[aria-label="Running"]')!.click(); await settle();
    expect(selected).toHaveBeenLastCalledWith(['Cycling', 'Running']);
    expect(trigger.value).toBe('2 selected');
    search.value = 'no match'; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(overlay.textContent).toContain('No matching sports.');
    expect(fixture.componentInstance.selectedValues()).toEqual(['Cycling', 'Running']);
    const clearSearch = overlay.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!;
    clearSearch.focus(); clearSearch.click(); await settle();
    expect(document.activeElement).toBe(search);
    expect(overlay.querySelector('[aria-label="Cycling"]')?.getAttribute('aria-selected')).toBe('true');
    const clear = Array.from(overlay.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === 'Clear selection')!;
    clear.click(); await settle();
    expect(selected).toHaveBeenLastCalledWith([]); expect(trigger.value).toBe('All sports');
    const done = Array.from(overlay.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === 'Done')!;
    done.click(); await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(haptics.selection).toHaveBeenCalledTimes(3);
  });
  it('retains locked choices on clear, family toggles and attempted removal, including while searched', async () => {
    const haptics = { selection: vi.fn() };
    TestBed.configureTestingModule({ imports: [ActivityFilterPickerComponent, NoopAnimationsModule], providers: [
      { provide: AppHapticsService, useValue: haptics },
      { provide: AppEventColorService, useValue: { getColorForActivityTypeByActivityTypeGroup: () => '#123456' } },
    ] });
    const fixture = TestBed.createComponent(ActivityFilterPickerComponent);
    fixture.componentRef.setInput('label', 'Excluded sports'); fixture.componentRef.setInput('allLabel', 'None excluded');
    fixture.componentRef.setInput('searchLabel', 'Search sports');
    fixture.componentRef.setInput('options', [
      { value: 'Cycling', label: 'Cycling', disabled: true, description: 'Required exclusion' },
      { value: 'Running', label: 'Running' }, { value: 'Yoga', label: 'Yoga', disabled: true },
    ]);
    fixture.componentRef.setInput('selectedValues', ['Cycling', 'Running']);
    fixture.componentRef.setInput('shortcuts', [{ label: 'Family', values: ['Cycling', 'Running', 'Yoga'] }]);
    const selected = vi.fn((values: string[]) => fixture.componentRef.setInput('selectedValues', values));
    fixture.componentInstance.selectionChange.subscribe(selected);
    const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    await settle(); fixture.componentInstance.openPicker(); await settle();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    expect(overlay.querySelector('[aria-label="Cycling"]')?.getAttribute('aria-disabled')).toBe('true');
    expect(overlay.textContent).toContain('Required exclusion');
    const lockedOption = overlay.querySelector('[aria-label="Cycling"]')!;
    const descriptionId = lockedOption.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toBe('Required exclusion');
    expect(overlay.querySelector('[aria-label="Running"]')?.hasAttribute('aria-describedby')).toBe(false);
    fixture.componentInstance.search.set('run'); await settle();
    fixture.componentInstance.clearSelection(); await settle();
    expect(selected).toHaveBeenLastCalledWith(['Cycling']);
    fixture.componentInstance.toggleShortcut({ label: 'Family', values: ['Cycling', 'Running', 'Yoga'] }, true); await settle();
    expect(selected).toHaveBeenLastCalledWith(['Cycling', 'Running']);
    fixture.componentInstance.toggleShortcut({ label: 'Family', values: ['Cycling', 'Running', 'Yoga'] }, false); await settle();
    expect(selected).toHaveBeenLastCalledWith(['Cycling']);
    const calls = selected.mock.calls.length;
    fixture.componentInstance.clearSelection(); expect(selected).toHaveBeenCalledTimes(calls);
    fixture.componentInstance.search.set(''); await settle();
    const clear = [...overlay.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Clear selection');
    expect(clear?.disabled).toBe(true);
  });

  it('uses an accessible compact trigger and ignores disabled or unchanged selections', async () => {
    const haptics = { selection: vi.fn() };
    TestBed.configureTestingModule({ imports: [ActivityFilterPickerComponent, NoopAnimationsModule], providers: [{ provide: AppHapticsService, useValue: haptics }] });
    const fixture = TestBed.createComponent(ActivityFilterPickerComponent);
    fixture.componentRef.setInput('label', 'Sports'); fixture.componentRef.setInput('allLabel', 'All sports');
    fixture.componentRef.setInput('searchLabel', 'Search sports'); fixture.componentRef.setInput('options', [{ value: 'Running', label: 'Running' }]);
    fixture.componentRef.setInput('compact', true); fixture.componentRef.setInput('triggerLabel', 'Filter tile activities');
    fixture.componentRef.setInput('disabled', true);
    const emit = vi.spyOn(fixture.componentInstance.selectionChange, 'emit'); fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-label')).toBe('Filter tile activities: All sports');
    expect(trigger.disabled).toBe(true); trigger.click(); fixture.componentInstance.openPicker();
    fixture.componentInstance.toggleShortcut({ label: 'Running', values: ['Running'] }, true);
    expect(emit).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
    fixture.componentRef.setInput('disabled', false); fixture.detectChanges(); trigger.focus(); trigger.click();
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fixture.componentRef.setInput('disabled', true); fixture.detectChanges();
    fixture.componentInstance.clearSelection(); fixture.componentInstance.toggleShortcut({ label: 'Running', values: ['Running'] }, true);
    expect(emit).not.toHaveBeenCalled();
    fixture.componentInstance.closePicker(); fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement === trigger || trigger.disabled).toBe(true);
  });

});
