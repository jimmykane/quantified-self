import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { ActivityTypes, DataDuration, DaysOfTheWeek, type EventInterface } from '@sports-alliance/sports-lib';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AppUserService } from '../../../services/app.user.service';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import { CalendarPageComponent } from './calendar-page.component';

describe('CalendarPageComponent', () => {
  const user = {
    uid: 'user-1',
    settings: { unitSettings: { startOfTheWeek: DaysOfTheWeek.Monday } },
  };
  let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let navigate: ReturnType<typeof vi.fn>;
  let watchEvents: ReturnType<typeof vi.fn>;
  let openBottomSheet: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    queryParams = new BehaviorSubject(convertToParamMap({ view: 'month', date: '2026-08-03' }));
    navigate = vi.fn().mockResolvedValue(true);
    watchEvents = vi.fn().mockReturnValue(of([createEvent()]));
    openBottomSheet = vi.fn();
    await TestBed.configureTestingModule({
      imports: [CalendarPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: {
          snapshot: { queryParamMap: queryParams.value },
          queryParamMap: queryParams.asObservable(),
        } },
        { provide: AppUserService, useValue: { user: signal(user), user$: of(user) } },
        { provide: ActivityCalendarService, useValue: { watchEvents } },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(navigate);
    vi.spyOn(TestBed.inject(MatBottomSheet), 'open').mockImplementation(openBottomSheet);
  });

  it('loads the visible month independently and renders its activity', async () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(watchEvents).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('#calendar-page-title')?.textContent).toContain('Calendar');
    expect(fixture.nativeElement.querySelector('.calendar-progress-slot')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-day-button')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('August 2026');
  });

  it('renders twelve months when the URL selects the yearly view', async () => {
    queryParams.next(convertToParamMap({ view: 'year', date: '2026-08-03' }));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-month')).toHaveLength(12);
  });

  it('pages by the selected view and keeps state in query parameters', () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();

    fixture.componentInstance.navigatePeriod(1);

    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({
      queryParams: { view: 'month', date: '2026-09-03' },
      queryParamsHandling: 'merge',
    }));
  });

  it('opens Material day details for an activity day', async () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const componentBottomSheet = (fixture.componentInstance as unknown as {
      bottomSheet: MatBottomSheet;
    }).bottomSheet;
    const componentOpen = vi.spyOn(componentBottomSheet, 'open').mockImplementation(openBottomSheet);

    const activityDay = fixture.componentInstance.calendarModel().months[0].days
      .find(day => day.eventCount > 0);
    fixture.componentInstance.openDay(activityDay);

    expect(componentOpen).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1' }),
    }));
  });

  it('shows a retryable error state', async () => {
    watchEvents.mockReturnValue(throwError(() => new Error('offline')));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
  });

  it('shows the selected month empty state when only an adjacent grid day has an activity', async () => {
    watchEvents.mockReturnValue(of([createEvent(new Date(2026, 8, 1, 8))]));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.hasEvents()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('No activities in August 2026');
    expect(fixture.nativeElement.querySelector('.calendar-status-announcement')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.calendar-status:not(.calendar-status--error)')).toBeNull();
  });

  it('refreshes the today marker when the window regains focus', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 7, 3, 10));
      watchEvents.mockReturnValue(of([]));
      const fixture = TestBed.createComponent(CalendarPageComponent);
      fixture.detectChanges();

      expect(fixture.componentInstance.calendarModel().months[0].days
        .find(day => day.dateKey === '2026-08-03')?.isToday).toBe(true);

      vi.setSystemTime(new Date(2026, 7, 4, 10));
      fixture.componentInstance.refreshToday();

      expect(fixture.componentInstance.calendarModel().months[0].days
        .find(day => day.dateKey === '2026-08-03')?.isToday).toBe(false);
      expect(fixture.componentInstance.calendarModel().months[0].days
        .find(day => day.dateKey === '2026-08-04')?.isToday).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

function createEvent(startDate = new Date(2026, 7, 3, 8)): EventInterface {
  return {
    name: 'Morning run',
    startDate,
    getID: () => 'event-1',
    getActivityTypesAsArray: () => [ActivityTypes.Running],
    getActivityTypesAsString: () => 'Running',
    getStat: (type: string) => type === DataDuration.type ? { getValue: () => 3600 } : null,
  } as unknown as EventInterface;
}
