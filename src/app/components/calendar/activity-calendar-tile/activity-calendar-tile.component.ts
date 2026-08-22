import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  LOCALE_ID,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { Router } from '@angular/router';
import type { EventInterface, User } from '@sports-alliance/sports-lib';
import { catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import {
  type ActivityCalendarDayViewModel,
  buildActivityCalendarViewModel,
  navigateActivityCalendarDate,
  parseActivityCalendarDate,
  resolveActivityCalendarQueryWindow,
} from '../../../helpers/activity-calendar.helper';
import { SharedModule } from '../../../modules/shared.module';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import { ActivityCalendarGridComponent } from '../activity-calendar-grid/activity-calendar-grid.component';
import {
  CalendarDayDetailsComponent,
  type CalendarDayDetailsData,
} from '../calendar-day-details/calendar-day-details.component';

interface ActivityCalendarTileState {
  status: 'loading' | 'ready' | 'error';
  events: EventInterface[];
}

@Component({
  selector: 'app-activity-calendar-tile',
  standalone: true,
  imports: [SharedModule, ActivityCalendarGridComponent],
  templateUrl: './activity-calendar-tile.component.html',
  styleUrls: ['./activity-calendar-tile.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityCalendarTileComponent {
  private readonly calendarService = inject(ActivityCalendarService);
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly router = inject(Router);
  private readonly dayDetailsNavigation = inject(CalendarDayDetailsNavigationService);
  private readonly locale = inject(LOCALE_ID);
  private readonly anchorDate = signal(startOfCurrentMonth());
  private readonly followsCurrentMonth = signal(true);
  private readonly reloadSequence = signal(0);
  private readonly today = signal(new Date());

  readonly user = input<User | null | undefined>(null);
  readonly showHeading = input(true);
  readonly showNavigation = input(false);
  readonly eventState = toSignal(combineLatest([
    toObservable(this.user),
    toObservable(this.anchorDate),
    toObservable(this.reloadSequence),
  ]).pipe(
    switchMap(([user, anchorDate]) => {
      if (!user?.uid) {
        return of({ status: 'ready', events: [] } as ActivityCalendarTileState);
      }
      const queryWindow = resolveActivityCalendarQueryWindow(
        'month',
        anchorDate,
        user.settings?.unitSettings?.startOfTheWeek,
      );
      return this.calendarService.watchEvents(user, queryWindow).pipe(
        map(events => ({ status: 'ready', events }) as ActivityCalendarTileState),
        startWith({ status: 'loading', events: [] } as ActivityCalendarTileState),
        catchError(() => of({ status: 'error', events: [] } as ActivityCalendarTileState)),
      );
    }),
  ), { initialValue: { status: 'loading', events: [] } as ActivityCalendarTileState });
  readonly calendarModel = computed(() => buildActivityCalendarViewModel(this.eventState().events, {
    view: 'month',
    anchorDate: this.anchorDate(),
    startOfWeek: this.user()?.settings?.unitSettings?.startOfTheWeek,
    locale: this.locale,
    now: this.today(),
  }));
  readonly isLoading = computed(() => this.eventState().status === 'loading');
  readonly hasError = computed(() => this.eventState().status === 'error');
  readonly hasEvents = computed(() => this.calendarModel().months.some(month => (
    month.days.some(day => day.inPrimaryPeriod && day.eventCount > 0)
  )));
  private readonly restoreDayDetailsEffect = effect(() => {
    const restoration = this.dayDetailsNavigation.restorationFor(this.router.url);
    if (!restoration) {
      return;
    }

    const restoredMonth = startOfCurrentMonth(parseActivityCalendarDate(restoration.dateKey));
    if (restoredMonth.getTime() !== this.anchorDate().getTime()) {
      this.followsCurrentMonth.set(false);
      this.anchorDate.set(restoredMonth);
      return;
    }
    if (this.eventState().status !== 'ready') {
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
    if (day?.eventCount) {
      this.openDay(day);
    }
  });

  @HostListener('window:focus')
  refreshCalendarDate(): void {
    const now = new Date();
    this.today.set(now);
    if (!this.followsCurrentMonth()) {
      return;
    }
    const currentMonth = startOfCurrentMonth(now);
    if (currentMonth.getTime() !== this.anchorDate().getTime()) {
      this.anchorDate.set(currentMonth);
    }
  }

  retry(): void {
    this.reloadSequence.update(value => value + 1);
  }

  navigateMonth(direction: -1 | 1): void {
    this.followsCurrentMonth.set(false);
    this.anchorDate.set(navigateActivityCalendarDate(this.anchorDate(), 'month', direction));
  }

  openDay(day: ActivityCalendarDayViewModel): void {
    const userId = `${this.user()?.uid || ''}`.trim();
    if (!day.eventCount || !userId) {
      return;
    }
    this.bottomSheet.open<CalendarDayDetailsComponent, CalendarDayDetailsData>(CalendarDayDetailsComponent, {
      data: {
        day,
        userId,
        locale: this.locale,
        unitSettings: this.user()?.settings?.unitSettings ?? null,
        summariesSettings: this.user()?.settings?.summariesSettings ?? null,
      },
    });
  }
}

function startOfCurrentMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
