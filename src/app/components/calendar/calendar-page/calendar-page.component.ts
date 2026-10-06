import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, LOCALE_ID, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ViewportScroller } from '@angular/common';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router, Scroll } from '@angular/router';
import type { EventInterface } from '@sports-alliance/sports-lib';
import { catchError, combineLatest, distinctUntilChanged, filter, map, of, shareReplay, startWith, switchMap, take, type Subscription } from 'rxjs';
import type { AppUserInterface } from '../../../models/app-user.interface';
import { SharedModule } from '../../../modules/shared.module';
import { AppUserService } from '../../../services/app.user.service';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import { getDateTimeFormatter } from '../../../helpers/date-time-format.helper';
import { revealCalendarDayContext } from '../../../helpers/reveal-calendar-day-context.helper';
import {
  TrainingPlansService,
  selectCalendarVisibleScheduledWorkouts,
  type CurrentTrainingScheduleV1,
} from '../../../services/training-plans.service';
import {
  type ActivityCalendarDayViewModel,
  type ActivityCalendarSummaryMetric,
  type ActivityCalendarRouteState,
  type ActivityCalendarView,
  buildActivityCalendarViewModel,
  buildActivityCalendarSelectedDay,
  formatActivityCalendarDateParam,
  formatActivityCalendarSummaryMetrics,
  navigateActivityCalendarDay,
  navigateActivityCalendarPeriod,
  normalizeActivityCalendarView,
  parseActivityCalendarDate,
  resolveActivityCalendarPrimaryRange,
  resolveActivityCalendarQueryWindow,
  resolveActivityCalendarVisibleWindow,
  resolveActivityCalendarDayRange,
  resolveActivityCalendarRouteState,
  resolveActivityCalendarViewAnchor,
  isActivityCalendarGridView,
} from '../../../helpers/activity-calendar.helper';
import {
  ACTIVITY_CALENDAR_VOLUME_TOOLTIP,
  buildActivityCalendarFamilyVolumeRows,
} from '../../../helpers/activity-calendar-volume.helper';
import { ActivityCalendarGridComponent } from '../activity-calendar-grid/activity-calendar-grid.component';
import { ActivityCalendarVolumeListComponent } from '../activity-calendar-volume-list/activity-calendar-volume-list.component';
import type { CalendarDayDetailsData } from '../calendar-day-details/calendar-day-details.component';
import { CalendarDayContextComponent } from '../calendar-day-context/calendar-day-context.component';
import { ActivityRangeTableSectionComponent } from '../../event-table/activity-range-table-section.component';
import { TimelineNotesWorkspaceComponent } from '../../timeline-notes/timeline-notes-workspace.component';
import { calendarTimelineNoteRange, calendarTimelineNotesByDate, calendarTimelineNoteRangesEqual } from '../../../helpers/calendar-timeline-notes.helper';
import {
  buildPlannedWorkoutCalendarOverlay,
  type PlannedWorkoutCalendarOverlay,
} from '../../../helpers/planned-workout-calendar.helper';
import { CalendarWeekSummaryComponent } from '../calendar-week-summary/calendar-week-summary.component';
import { buildCalendarWeekSummary, type CalendarWeekSource } from '../../../helpers/calendar-week-summary.helper';
import type { TrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { TrainingImpactService, type TrainingImpactSnapshotState } from '../../../services/training-impact.service';

interface CalendarEventsState {
  status: 'loading' | 'ready' | 'error';
  events: EventInterface[];
  complete?: boolean;
}

interface CalendarPlansState {
  status: 'loading' | 'ready' | 'error';
  schedule: CurrentTrainingScheduleV1 | null;
  restoreInProgress?: boolean;
}

interface CalendarCompletionState extends CalendarWeekSource<TrainingWorkoutCompletionV1[]> { context: string }

interface CalendarViewOption {
  value: ActivityCalendarView;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-calendar-page',
  standalone: true,
  imports: [
    SharedModule,
    CalendarWeekSummaryComponent,
    ActivityCalendarGridComponent,
    CalendarDayContextComponent,
    ActivityCalendarVolumeListComponent,
    ActivityRangeTableSectionComponent,
    TimelineNotesWorkspaceComponent,
  ],
  templateUrl: './calendar-page.component.html',
  styleUrls: ['./calendar-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly viewportScroller = inject(ViewportScroller);
  private readonly destroyRef = inject(DestroyRef);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private pendingScrollRestore: Subscription | null = null;
  private readonly userService = inject(AppUserService);
  private readonly calendarService = inject(ActivityCalendarService);
  private readonly plansService = inject(TrainingPlansService);
  private readonly dayDetailsNavigation = inject(CalendarDayDetailsNavigationService);
  private readonly trainingImpact = inject(TrainingImpactService);
  private readonly locale = inject(LOCALE_ID);
  private readonly haptics = inject(AppHapticsService);
  private readonly notesWorkspace = viewChild(TimelineNotesWorkspaceComponent);
  private readonly reloadSequence = signal(0);
  private readonly today = signal(new Date());
  readonly isDayRoute = this.route.snapshot.data?.['calendarMode'] === 'day';
  private readonly initialRouteState = resolveRouteState(
    this.route.snapshot.queryParamMap,
    this.isDayRoute ? this.route.snapshot.paramMap.get('date') : null,
    this.userService.user()?.settings?.unitSettings?.startOfTheWeek,
  );
  private readonly routeState$ = combineLatest([this.route.queryParamMap, this.route.paramMap,
    this.userService.user$.pipe(map(user => user?.settings?.unitSettings?.startOfTheWeek), distinctUntilChanged()),
  ]).pipe(
    map(([queryParams, routeParams, weekStart]) => resolveRouteState(
      queryParams, this.isDayRoute ? routeParams.get('date') : null,
      weekStart,
    )),
    distinctUntilChanged((previous, current) => (
      previous.view === current.view
      && formatActivityCalendarDateParam(previous.anchorDate) === formatActivityCalendarDateParam(current.anchorDate)
      && formatActivityCalendarDateParam(previous.selectedDate) === formatActivityCalendarDateParam(current.selectedDate)
    )),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly viewOptions: ReadonlyArray<CalendarViewOption> = [
    { value: 'week', label: 'Week', icon: 'view_week' },
    { value: 'month', label: 'Month', icon: 'calendar_view_month' },
    { value: '30d', label: '30 days', icon: 'date_range' },
    { value: 'year', label: 'Year', icon: 'calendar_month' },
  ];
  readonly isWeekView = computed(() => !this.isDayRoute && this.routeState().view === 'week');
  readonly isGridView = computed(() => isActivityCalendarGridView(this.routeState().view));
  readonly periodUnitLabel = computed(() => this.routeState().view === '30d' ? '30-day period' : this.routeState().view);
  readonly familyVolumeTooltip = ACTIVITY_CALENDAR_VOLUME_TOOLTIP;
  readonly routeState = toSignal(this.routeState$, { initialValue: this.initialRouteState });
  readonly openedFromDashboard = toSignal(this.route.queryParamMap.pipe(map(params => params.get('from') === 'dashboard')), {
    initialValue: this.route.snapshot.queryParamMap.get('from') === 'dashboard',
  });
  private readonly explicitDateParam = toSignal(this.route.queryParamMap.pipe(map(params => params.get('date'))), {
    initialValue: this.route.snapshot.queryParamMap.get('date'),
  });
  private readonly dayRouteDateParam = toSignal(this.route.paramMap.pipe(map(params => params.get('date'))), {
    initialValue: this.route.snapshot.paramMap.get('date'),
  });
  readonly currentUser = computed(() => this.userService.user() as AppUserInterface | null);
  private readonly trainingImpactSource = computed(() => {
    const uid = this.currentUser()?.uid;
    return uid
      ? this.trainingImpact.watch(uid)
      : of({ status: 'private', formPoints: null } as TrainingImpactSnapshotState);
  });
  readonly trainingImpactState = toSignal(
    toObservable(this.trainingImpactSource).pipe(switchMap(source => source)),
    { initialValue: { status: 'private', formPoints: null } as TrainingImpactSnapshotState },
  );
  readonly hasTrainingPlanningUIAccess = computed(() => !!this.currentUser()?.uid);
  readonly eventState = toSignal(combineLatest([
    this.userService.user$,
    this.routeState$,
    toObservable(this.reloadSequence),
  ]).pipe(
    map(([user, state, reload]) => ({ user, reload, week: !this.isDayRoute && state.view === 'week', window: this.isDayRoute
      ? resolveActivityCalendarDayRange(state.anchorDate)
      : resolveActivityCalendarQueryWindow(state.view, state.anchorDate, user?.settings?.unitSettings?.startOfTheWeek) })),
    distinctUntilChanged((a, b) => a.user?.uid === b.user?.uid && a.reload === b.reload
      && a.week === b.week && a.window.startMs === b.window.startMs && a.window.endExclusiveMs === b.window.endExclusiveMs),
    switchMap(({ user, week, window: queryWindow }) => {
      if (!user?.uid) return of({ status: 'ready', events: [] } as CalendarEventsState);
      const events$ = week ? this.calendarService.watchWeekEvents(user, queryWindow)
        : this.calendarService.watchEvents(user, queryWindow).pipe(map(events => ({ events, complete: true })));
      return events$.pipe(
        map(result => ({ status: 'ready', ...result }) as CalendarEventsState),
        startWith({ status: 'loading', events: [] } as CalendarEventsState),
        catchError(() => of({ status: 'error', events: [] } as CalendarEventsState)),
      );
    }),
  ), { initialValue: { status: 'loading', events: [] } as CalendarEventsState });
  readonly plansState = toSignal(combineLatest([this.userService.user$, this.routeState$, toObservable(this.reloadSequence)]).pipe(
    map(([user, state, reload]) => ({ uid: user?.uid, reload, week: !this.isDayRoute && state.view === 'week',
      window: resolveActivityCalendarQueryWindow(state.view, state.anchorDate, user?.settings?.unitSettings?.startOfTheWeek) })),
    distinctUntilChanged((a, b) => a.uid === b.uid && a.reload === b.reload && a.week === b.week
      && (!a.week || (a.window.startMs === b.window.startMs && a.window.endExclusiveMs === b.window.endExclusiveMs))),
    switchMap(({ uid, week, window }) => {
      if (!uid) return of({ status: 'ready', schedule: null } as CalendarPlansState);
      const schedule$ = week ? this.plansService.watchCalendarSchedule(uid, formatActivityCalendarDateParam(new Date(window.startMs)),
        formatActivityCalendarDateParam(new Date(window.endExclusiveMs - 1))) : this.plansService.watchSchedule(uid);
      return schedule$.pipe(
        map(schedule => schedule.restoreUnavailable
          ? ({ status: 'error', schedule: null, restoreInProgress: true } as CalendarPlansState)
          : ({ status: 'ready', schedule } as CalendarPlansState)),
        startWith({ status: 'loading', schedule: null } as CalendarPlansState),
        catchError(() => of({ status: 'error', schedule: null } as CalendarPlansState)),
      );
    }),
  ), { initialValue: { status: 'loading', schedule: null } as CalendarPlansState });
  private readonly completionContext = computed(() => JSON.stringify([this.currentUser()?.uid, this.isWeekView(), this.reloadSequence(),
    this.plansState().schedule ? selectCalendarVisibleScheduledWorkouts(this.plansState().schedule!).map(workout => workout.id).sort() : []]));
  readonly completionState = toSignal(combineLatest([this.userService.user$, toObservable(this.plansState),
    toObservable(this.isWeekView), toObservable(this.reloadSequence)]).pipe(
    map(([user, plans, week, reload]) => ({ uid: user?.uid, week, reload, status: plans.status,
      ids: plans.schedule ? selectCalendarVisibleScheduledWorkouts(plans.schedule).map(workout => workout.id).sort() : [] })),
    distinctUntilChanged((a, b) => a.uid === b.uid && a.week === b.week && a.reload === b.reload
      && a.status === b.status && JSON.stringify(a.ids) === JSON.stringify(b.ids)),
    switchMap(({ uid, week, reload, status, ids }) => {
      const context = JSON.stringify([uid, week, reload, ids]);
      if (!uid) return of({ status: 'ready', data: [], complete: true, context } as CalendarCompletionState);
      if (week && status !== 'ready') return of({ status, data: [], complete: false, context } as CalendarCompletionState);
      const links$ = week ? this.plansService.watchWorkoutCompletionsForWorkouts(uid, ids) : this.plansService.watchWorkoutCompletions(uid);
      return links$.pipe(
        map(data => ({ status: 'ready', data, complete: true, context } as CalendarCompletionState)),
        startWith({ status: 'loading', data: [], complete: false, context } as CalendarCompletionState),
        catchError(() => of({ status: 'error', data: [], complete: false, context } as CalendarCompletionState)),
      );
    }),
  ), { initialValue: { status: 'loading', data: [], complete: false, context: '' } as CalendarCompletionState });
  private readonly currentCompletions = computed<CalendarWeekSource<TrainingWorkoutCompletionV1[]>>(() =>
    this.completionState().context === this.completionContext() ? this.completionState() : { status: 'loading', data: [], complete: false });
  readonly workoutCompletions = computed(() => this.currentCompletions().data);
  readonly weekSummary = computed(() => {
    const window = resolveActivityCalendarQueryWindow('week', this.routeState().anchorDate,
      this.currentUser()?.settings?.unitSettings?.startOfTheWeek);
    return buildCalendarWeekSummary({ window, startLocalDate: formatActivityCalendarDateParam(new Date(window.startMs)),
      endLocalDate: formatActivityCalendarDateParam(new Date(window.endExclusiveMs - 1)),
      events: { status: this.eventState().status, data: this.eventState().events, complete: this.eventState().complete !== false },
      schedule: { status: this.plansState().status, data: this.plansState().schedule, complete: this.plansState().schedule?.workoutsComplete !== false },
      completions: this.currentCompletions(), unitSettings: this.currentUser()?.settings?.unitSettings, locale: this.locale });
  });
  readonly canRetryWeek = computed(() => this.eventState().status === 'error' || this.plansState().status === 'error'
    || this.completionState().status === 'error');
  readonly plannedWorkoutsByDate = computed<PlannedWorkoutCalendarOverlay>(() => {
    const schedule = this.plansState().schedule;
    if (!this.hasTrainingPlanningUIAccess() || !schedule) return {};
    return buildPlannedWorkoutCalendarOverlay(
      selectCalendarVisibleScheduledWorkouts(schedule),
      schedule.plans,
      schedule.state.activePlanId,
      this.workoutCompletions().map(completion => completion.workoutId),
    );
  });
  readonly calendarModel = computed(() => {
    const state = this.routeState();
    return buildActivityCalendarViewModel(this.eventState().events, {
      view: state.view,
      anchorDate: state.anchorDate,
      startOfWeek: this.currentUser()?.settings?.unitSettings?.startOfTheWeek,
      summariesSettings: this.currentUser()?.settings?.summariesSettings,
      locale: this.locale,
      now: this.today(),
    });
  });
  readonly primaryActivityRange = computed(() => this.isDayRoute
    ? resolveActivityCalendarDayRange(this.routeState().anchorDate)
    : resolveActivityCalendarPrimaryRange(
      this.routeState().view,
      this.routeState().anchorDate,
      this.currentUser()?.settings?.unitSettings?.startOfTheWeek,
    ));
  readonly timelineNoteRange = computed(() => this.isDayRoute
    ? { startDate: formatActivityCalendarDateParam(this.routeState().anchorDate),
      endDate: formatActivityCalendarDateParam(this.routeState().anchorDate) }
    : calendarTimelineNoteRange(this.calendarModel(), this.selectedDay()), { equal: calendarTimelineNoteRangesEqual });
  readonly notesByDate = computed(() => {
    const workspace = this.notesWorkspace();
    const notes = this.currentUser()?.uid === workspace?.service.uid() ? workspace?.context().notes ?? [] : [];
    return calendarTimelineNotesByDate(this.calendarModel(), notes, this.today().getTime(), this.selectedDay());
  });
  readonly periodSummaryMetrics = computed<ActivityCalendarSummaryMetric[]>(() => formatActivityCalendarSummaryMetrics(
    this.eventState().status === 'ready' ? this.calendarModel().summary : null,
    this.currentUser()?.settings?.unitSettings, this.locale,
  ));
  readonly familyVolumeRows = computed(() => {
    if (this.eventState().status !== 'ready') {
      return [];
    }

    return buildActivityCalendarFamilyVolumeRows(
      this.calendarModel().summary,
      this.currentUser()?.settings?.unitSettings ?? null,
      this.locale,
    );
  });
  readonly isLoading = computed(() => this.eventState().status === 'loading');
  readonly hasError = computed(() => this.eventState().status === 'error');
  readonly hasEvents = computed(() => this.calendarModel().months.some(month => (
    month.days.some(day => day.inPrimaryPeriod && day.eventCount > 0)
  )));
  readonly emptyStateLabel = computed(() => this.isDayRoute
    ? 'No completed activities for this day'
    : `No completed activities in ${this.calendarModel().periodLabel}`);
  readonly dayTitle = computed(() => getDateTimeFormatter(this.locale, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  }).format(this.routeState().anchorDate));
  readonly dayShortTitle = computed(() => getDateTimeFormatter(this.locale, {
    day: 'numeric', month: 'short', year: '2-digit',
  }).format(this.routeState().anchorDate));
  private readonly calendarReturnParams = toSignal(this.route.queryParamMap.pipe(map(params => ({
    view: params.get('calendarView'), anchor: params.get('calendarAnchor'), surface: params.get('calendarSurface'),
  }))), { initialValue: { view: this.route.snapshot.queryParamMap.get('calendarView'), anchor: this.route.snapshot.queryParamMap.get('calendarAnchor'),
    surface: this.route.snapshot.queryParamMap.get('calendarSurface') } });
  readonly calendarBackQuery = computed(() => {
    const view = normalizeActivityCalendarView(this.calendarReturnParams().view);
    const date = this.routeState().selectedDate;
    const savedAnchor = this.calendarReturnParams().anchor;
    if (!savedAnchor) return { view, date: formatActivityCalendarDateParam(date) };
    const anchor = parseActivityCalendarDate(savedAnchor, date);
    const window = resolveActivityCalendarVisibleWindow(view, anchor, this.currentUser()?.settings?.unitSettings?.startOfTheWeek);
    // Adjacent-day navigation may leave the original grid; keep the returned day visible.
    const visibleAnchor = date.getTime() >= window.startMs && date.getTime() < window.endExclusiveMs
      ? anchor : resolveActivityCalendarViewAnchor(view, date, this.today());
    return { view, date: formatActivityCalendarDateParam(date), anchor: formatActivityCalendarDateParam(visibleAnchor) };
  });
  readonly dayBackNavigation = computed(() => this.openedFromDashboard()
    ? { route: ['/dashboard'], query: null, label: 'Dashboard', ariaLabel: 'Back to dashboard' }
    : { route: ['/calendar'], query: this.calendarBackQuery(), label: 'Calendar', ariaLabel: 'Back to calendar for this day' });
  readonly selectedDay = computed(() => {
    const dateKey = formatActivityCalendarDateParam(this.routeState().selectedDate);
    return this.calendarModel().months.flatMap(month => month.days)
      .find(day => day.dateKey === dateKey)
      ?? buildActivityCalendarSelectedDay(this.eventState().events, this.routeState().selectedDate, this.locale, this.today());
  });
  readonly selectedDayActivities = computed(() => ({
    day: this.selectedDay()!, status: this.eventState().status,
  }));
  readonly selectedDayNotes = computed(() => this.notesByDate().get(this.selectedDay()?.dateKey || '')?.notes ?? []);
  readonly selectedDayPlanned = computed(() => this.plannedWorkoutsByDate()[this.selectedDay()?.dateKey || '']?.entries ?? []);
  readonly selectedDayData = computed<CalendarDayDetailsData | null>(() => {
    const day = this.selectedDay();
    const user = this.currentUser();
    if (!day || !user?.uid) return null;
    return {
      day, userId: user.uid, locale: this.locale,
      calendarReturn: { view: this.routeState().view, anchor: formatActivityCalendarDateParam(this.routeState().anchorDate) },
      planningEnabled: this.hasTrainingPlanningUIAccess(),
      unitSettings: user.settings?.unitSettings ?? null,
      summariesSettings: user.settings?.summariesSettings ?? null,
      timelineNotes: this.selectedDayNotes,
      timelineNotesStatusSource: () => {
        const workspace = this.notesWorkspace();
        if (!workspace || workspace.service.uid() !== user.uid || workspace.loading()) return 'loading';
        return workspace.error() ? 'error' : 'ready';
      },
      activities: this.selectedDayActivities,
      plannedWorkoutsSource: this.selectedDayPlanned,
      plannedWorkoutsStatusSource: () => this.plansState().status,
      scheduleSource: () => this.currentUser()?.uid === user.uid ? this.plansState().schedule : null,
      trainingImpact: this.trainingImpactState,
    };
  });
  private readonly restoreDayDetailsEffect = effect(() => {
    const restoration = this.dayDetailsNavigation.restorationFor(this.router.url);
    if (!restoration || this.eventState().status !== 'ready') {
      return;
    }

    const day = this.calendarModel().months
      .flatMap(month => month.days)
      .find(candidate => candidate.dateKey === restoration.dateKey);
    if (restoration.deletedEventId && day?.events.some(event => event.getID() === restoration.deletedEventId)) {
      return;
    }
    if (!this.dayDetailsNavigation.consumeRestoration(restoration)) {
      return;
    }
    if (day && this.selectedDay()?.dateKey !== day.dateKey) this.openDay(day, false);
  });
  private readonly openDuplicatedDayEffect = effect(() => {
    const uid = this.currentUser()?.uid;
    if (!uid) return;
    const dateKey = this.dayDetailsNavigation.workoutDestinationFor(uid);
    if (!dateKey || formatActivityCalendarDateParam(this.routeState().selectedDate) !== dateKey
      || this.eventState().status === 'loading') return;
    const day = this.calendarModel().months.flatMap(month => month.days)
      .find(candidate => candidate.dateKey === dateKey);
    if (day) this.dayDetailsNavigation.consumeWorkoutDestination(uid, dateKey);
  });
  private readonly canonicalDayRouteEffect = effect(() => {
    if (!this.isDayRoute) return;
    const routeDate = this.dayRouteDateParam();
    const canonicalDate = formatActivityCalendarDateParam(parseActivityCalendarDate(routeDate));
    if (routeDate !== canonicalDate) {
      this.navigateToDay(canonicalDate, true);
    }
  });

  @HostListener('window:focus')
  refreshToday(): void {
    this.today.set(new Date());
  }

  @HostListener('document:visibilitychange')
  refreshVisibleToday(): void {
    // Mobile tab/app resumes need not emit window focus. Keep ongoing note cutoffs current too.
    if (document.visibilityState === 'visible') this.refreshToday();
  }

  selectView(value: unknown): void {
    const view = normalizeActivityCalendarView(value, this.routeState().view);
    if (view === this.routeState().view) {
      return;
    }
    this.haptics.selection();
    this.navigateToState({ ...this.routeState(), view,
      anchorDate: resolveActivityCalendarViewAnchor(view, this.routeState().selectedDate, this.today()) });
  }

  navigatePeriod(direction: -1 | 1): void {
    const state = this.routeState();
    if (this.isDayRoute) {
      this.navigateToState({ ...state, anchorDate: navigateActivityCalendarDay(state.anchorDate, direction) });
      return;
    }
    this.navigateToState(navigateActivityCalendarPeriod(state, direction));
  }

  goToToday(): void {
    this.navigateToState({ ...this.routeState(), anchorDate: new Date(), selectedDate: new Date() });
  }

  retry(): void {
    this.reloadSequence.update(value => value + 1);
  }

  openDay(day: ActivityCalendarDayViewModel, revealDay = true): void {
    const state = this.routeState();
    const isNarrowYear = revealDay && state.view === 'year'
      && this.elementRef.nativeElement.ownerDocument.defaultView?.matchMedia?.('(max-width: 900px)')?.matches;
    if (!this.currentUser()?.uid || (!isNarrowYear
      && this.selectedDay()?.dateKey === day.dateKey && this.explicitDateParam() === day.dateKey)) return;
    this.navigateToState({ ...state, view: isNarrowYear ? 'month' : state.view,
      anchorDate: isNarrowYear ? day.date : state.anchorDate, selectedDate: day.date }, revealDay);
  }

  selectDayNote(noteId: string): void {
    const note = this.selectedDayNotes().find(candidate => candidate.id === noteId);
    if (note && this.currentUser()?.uid === this.notesWorkspace()?.service.uid()) {
      this.notesWorkspace()?.context().select([note]);
    }
  }

  prepareDayBackNavigation(): void {
    if (!this.isDayRoute || !this.openedFromDashboard() || !this.currentUser()?.uid) return;
    const context = this.calendarBackQuery();
    // The activity/workout visit may have replaced the transient return record;
    // reconstruct it from the full-day URL, including after a page reload.
    this.dayDetailsNavigation.prepareReturn('/dashboard', context.date,
      this.calendarReturnParams().surface === 'today-sheet' ? 'today-sheet' : undefined,
      { view: context.view === '30d' ? '30d' : 'month', anchor: context.anchor ?? context.date });
  }

  private navigateToState(state: ActivityCalendarRouteState, revealDay = false): void {
    if (this.isDayRoute) {
      this.navigateToDay(formatActivityCalendarDateParam(state.anchorDate));
      return;
    }
    const viewChanged = state.view !== this.routeState().view;
    const scrollPosition = this.viewportScroller.getScrollPosition();
    const targetDate = formatActivityCalendarDateParam(state.selectedDate);
    this.pendingScrollRestore?.unsubscribe();
    // The app router scrolls to the top after query-only navigation. Restore the
    // current position after its Scroll event so selecting a day stays in context.
    const scrollRestore = this.router.events.pipe(
      filter((event): event is Scroll => {
        if (!(event instanceof Scroll)) return false;
        const url = 'urlAfterRedirects' in event.routerEvent
          ? event.routerEvent.urlAfterRedirects : event.routerEvent.url;
        const params = this.router.parseUrl(url).queryParamMap;
        return params.get('view') === state.view && params.get('date') === targetDate
          && params.get('anchor') === formatActivityCalendarDateParam(state.anchorDate);
      }),
      take(1),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(event => {
      if (this.pendingScrollRestore === scrollRestore) this.pendingScrollRestore = null;
      if (event.position) return; // Browser Back already restores its saved position.
      Promise.resolve().then(() => {
        if (this.destroyRef.destroyed) return;
        if (!viewChanged) this.viewportScroller.scrollToPosition(scrollPosition);
        if (revealDay) requestAnimationFrame(() => {
          if (!this.destroyRef.destroyed) revealCalendarDayContext(this.elementRef.nativeElement);
        });
      });
    });
    this.pendingScrollRestore = scrollRestore;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        view: state.view,
        date: targetDate,
        anchor: formatActivityCalendarDateParam(state.anchorDate),
      },
      queryParamsHandling: 'merge',
    }).then(navigated => {
      if (!navigated && this.pendingScrollRestore === scrollRestore) {
        scrollRestore.unsubscribe();
        this.pendingScrollRestore = null;
      }
    }).catch(() => {
      if (this.pendingScrollRestore === scrollRestore) {
        scrollRestore.unsubscribe();
        this.pendingScrollRestore = null;
      }
    });
  }

  private navigateToDay(dateKey: string, replaceUrl = false): void {
    const route = ['/calendar/day', dateKey];
    const returnParams = this.calendarReturnParams();
    const origin = this.openedFromDashboard() || returnParams.view || returnParams.anchor ? {
      ...(this.openedFromDashboard() ? { from: 'dashboard' } : {}),
      ...(this.openedFromDashboard() && returnParams.surface === 'today-sheet' ? { calendarSurface: 'today-sheet' } : {}),
      ...(returnParams.view ? { calendarView: normalizeActivityCalendarView(returnParams.view) } : {}),
      ...(returnParams.anchor ? { calendarAnchor: formatActivityCalendarDateParam(parseActivityCalendarDate(returnParams.anchor)) } : {}),
    } : null;
    if (origin || replaceUrl) {
      void this.router.navigate(route, {
        ...(origin ? { queryParams: origin } : {}),
        ...(replaceUrl ? { replaceUrl: true } : {}),
      });
      return;
    }
    void this.router.navigate(route);
  }
}

function resolveRouteState(params: ParamMap, pathDate: string | null = null, startOfWeek?: number | null): ActivityCalendarRouteState {
  return resolveActivityCalendarRouteState({
    view: pathDate === null ? params.get('view') : 'month',
    date: pathDate ?? params.get('date'),
    anchor: pathDate ?? params.get('anchor'),
  }, new Date(), startOfWeek);
}
