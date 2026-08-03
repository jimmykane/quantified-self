import { ChangeDetectionStrategy, Component, HostListener, LOCALE_ID, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import type { EventInterface } from '@sports-alliance/sports-lib';
import { catchError, combineLatest, distinctUntilChanged, filter, map, of, shareReplay, startWith, switchMap } from 'rxjs';
import type { AppUserInterface } from '../../../models/app-user.interface';
import { SharedModule } from '../../../modules/shared.module';
import { AppUserService } from '../../../services/app.user.service';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import {
  type ActivityCalendarDayViewModel,
  type ActivityCalendarRouteState,
  type ActivityCalendarView,
  buildActivityCalendarViewModel,
  formatActivityCalendarDateParam,
  navigateActivityCalendarDate,
  normalizeActivityCalendarView,
  parseActivityCalendarDate,
  resolveActivityCalendarQueryWindow,
} from '../../../helpers/activity-calendar.helper';
import { ActivityCalendarGridComponent } from '../activity-calendar-grid/activity-calendar-grid.component';
import {
  CalendarDayDetailsComponent,
  type CalendarDayDetailsData,
} from '../calendar-day-details/calendar-day-details.component';

interface CalendarEventsState {
  status: 'loading' | 'ready' | 'error';
  events: EventInterface[];
}

interface CalendarViewOption {
  value: ActivityCalendarView;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-calendar-page',
  standalone: true,
  imports: [SharedModule, ActivityCalendarGridComponent],
  templateUrl: './calendar-page.component.html',
  styleUrls: ['./calendar-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly userService = inject(AppUserService);
  private readonly calendarService = inject(ActivityCalendarService);
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly locale = inject(LOCALE_ID);
  private readonly reloadSequence = signal(0);
  private readonly today = signal(new Date());
  private readonly initialRouteState = resolveRouteState(this.route.snapshot.queryParamMap);
  private readonly routeState$ = this.route.queryParamMap.pipe(
    map(params => resolveRouteState(params)),
    distinctUntilChanged((previous, current) => (
      previous.view === current.view
      && formatActivityCalendarDateParam(previous.anchorDate) === formatActivityCalendarDateParam(current.anchorDate)
    )),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly viewOptions: ReadonlyArray<CalendarViewOption> = [
    { value: 'week', label: 'Week', icon: 'view_week' },
    { value: 'month', label: 'Month', icon: 'calendar_view_month' },
    { value: 'year', label: 'Year', icon: 'calendar_month' },
  ];
  readonly routeState = toSignal(this.routeState$, { initialValue: this.initialRouteState });
  readonly currentUser = computed(() => this.userService.user() as AppUserInterface | null);
  readonly eventState = toSignal(combineLatest([
    this.userService.user$.pipe(
      filter((user): user is AppUserInterface => !!user?.uid),
    ),
    this.routeState$,
    toObservable(this.reloadSequence),
  ]).pipe(
    switchMap(([user, state]) => {
      const startOfWeek = user.settings?.unitSettings?.startOfTheWeek;
      const queryWindow = resolveActivityCalendarQueryWindow(state.view, state.anchorDate, startOfWeek);
      return this.calendarService.watchEvents(user, queryWindow).pipe(
        map(events => ({ status: 'ready', events }) as CalendarEventsState),
        startWith({ status: 'loading', events: [] } as CalendarEventsState),
        catchError(() => of({ status: 'error', events: [] } as CalendarEventsState)),
      );
    }),
  ), { initialValue: { status: 'loading', events: [] } as CalendarEventsState });
  readonly calendarModel = computed(() => {
    const state = this.routeState();
    return buildActivityCalendarViewModel(this.eventState().events, {
      view: state.view,
      anchorDate: state.anchorDate,
      startOfWeek: this.currentUser()?.settings?.unitSettings?.startOfTheWeek,
      locale: this.locale,
      now: this.today(),
    });
  });
  readonly isLoading = computed(() => this.eventState().status === 'loading');
  readonly hasError = computed(() => this.eventState().status === 'error');
  readonly hasEvents = computed(() => this.calendarModel().months.some(month => (
    month.days.some(day => day.inPrimaryPeriod && day.eventCount > 0)
  )));
  readonly emptyStateLabel = computed(() => `No activities in ${this.calendarModel().periodLabel}`);

  @HostListener('window:focus')
  refreshToday(): void {
    this.today.set(new Date());
  }

  selectView(value: unknown): void {
    const view = normalizeActivityCalendarView(value, this.routeState().view);
    if (view === this.routeState().view) {
      return;
    }
    this.navigateToState({ ...this.routeState(), view });
  }

  navigatePeriod(direction: -1 | 1): void {
    const state = this.routeState();
    this.navigateToState({
      ...state,
      anchorDate: navigateActivityCalendarDate(state.anchorDate, state.view, direction),
    });
  }

  goToToday(): void {
    this.navigateToState({ ...this.routeState(), anchorDate: new Date() });
  }

  retry(): void {
    this.reloadSequence.update(value => value + 1);
  }

  openDay(day: ActivityCalendarDayViewModel): void {
    const userId = `${this.currentUser()?.uid || ''}`.trim();
    if (!day.eventCount || !userId) {
      return;
    }
    this.bottomSheet.open<CalendarDayDetailsComponent, CalendarDayDetailsData>(CalendarDayDetailsComponent, {
      data: { day, userId, locale: this.locale },
    });
  }

  private navigateToState(state: ActivityCalendarRouteState): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        view: state.view,
        date: formatActivityCalendarDateParam(state.anchorDate),
      },
      queryParamsHandling: 'merge',
    });
  }
}

function resolveRouteState(params: ParamMap): ActivityCalendarRouteState {
  return {
    view: normalizeActivityCalendarView(params.get('view')),
    anchorDate: parseActivityCalendarDate(params.get('date')),
  };
}
