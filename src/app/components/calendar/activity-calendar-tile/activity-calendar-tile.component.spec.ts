import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { provideRouter } from '@angular/router';
import { ActivityTypes, DataDuration, DaysOfTheWeek, type EventInterface } from '@sports-alliance/sports-lib';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import { ActivityCalendarTileComponent } from './activity-calendar-tile.component';

describe('ActivityCalendarTileComponent', () => {
  const user = {
    uid: 'user-1',
    settings: { unitSettings: { startOfTheWeek: DaysOfTheWeek.Monday } },
  };
  let watchEvents: ReturnType<typeof vi.fn>;
  let openBottomSheet: ReturnType<typeof vi.fn>;
  let dayDetailsNavigation: {
    restorationFor: ReturnType<typeof vi.fn>;
    consumeRestoration: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    watchEvents = vi.fn().mockReturnValue(of([createEvent()]));
    openBottomSheet = vi.fn();
    dayDetailsNavigation = {
      restorationFor: vi.fn().mockReturnValue(null),
      consumeRestoration: vi.fn().mockReturnValue(true),
    };
    await TestBed.configureTestingModule({
      imports: [ActivityCalendarTileComponent],
      providers: [
        provideRouter([]),
        { provide: ActivityCalendarService, useValue: { watchEvents } },
        { provide: CalendarDayDetailsNavigationService, useValue: dayDetailsNavigation },
      ],
    }).compileComponents();
  });

  it('loads the current month with its own query and renders compact concentric markers', async () => {
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(watchEvents).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('.activity-calendar-tile-progress')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.activity-calendar--compact')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.activity-calendar-marker-stage--concentric')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Activity calendar');
  });

  it('opens the shared day details sheet from an activity day', async () => {
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const componentBottomSheet = (fixture.componentInstance as unknown as {
      bottomSheet: MatBottomSheet;
    }).bottomSheet;
    vi.spyOn(componentBottomSheet, 'open').mockImplementation(openBottomSheet);
    (fixture.nativeElement.querySelector('.activity-calendar-day-button') as HTMLButtonElement).click();

    expect(openBottomSheet).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-1',
        unitSettings: user.settings.unitSettings,
      }),
    }));
  });

  it('pages the compact month picker without rendering the tile heading', async () => {
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('showHeading', false);
    fixture.componentRef.setInput('showNavigation', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const initialPeriod = fixture.componentInstance.calendarModel().periodLabel;
    const previousMonth = fixture.nativeElement.querySelector('[aria-label="Previous month"]') as HTMLButtonElement;
    expect(fixture.nativeElement.querySelector('#activity-calendar-tile-title')).toBeNull();
    expect(fixture.nativeElement.querySelector('.activity-calendar-tile-navigation')?.textContent).toContain(initialPeriod);

    previousMonth.click();
    fixture.detectChanges();

    expect(watchEvents).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.calendarModel().periodLabel).not.toBe(initialPeriod);
  });

  it('shows a retry action when the month query fails', async () => {
    watchEvents.mockReturnValue(throwError(() => new Error('offline')));
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('Calendar unavailable');
  });

  it('shows the empty state when query results only belong to an adjacent month', async () => {
    const now = new Date();
    watchEvents.mockReturnValue(of([createEvent(new Date(now.getFullYear(), now.getMonth() + 1, 1, 8))]));
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No activities this month');
    expect(fixture.nativeElement.querySelector('.activity-calendar-day-button')).toBeNull();
  });

  it('refreshes the today marker without re-querying during the same month', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 7, 3, 10));
      watchEvents.mockReturnValue(of([createEvent(new Date(2026, 7, 3, 8))]));
      const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
      fixture.componentRef.setInput('user', user);
      fixture.detectChanges();

      vi.setSystemTime(new Date(2026, 7, 4, 10));
      fixture.componentInstance.refreshCalendarDate();

      expect(fixture.componentInstance.calendarModel().months[0].days
        .find(day => day.dateKey === '2026-08-04')?.isToday).toBe(true);
      expect(watchEvents).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reopens day details after returning from an event route', async () => {
    const now = new Date();
    const dateKey = [
      now.getFullYear(),
      `${now.getMonth() + 1}`.padStart(2, '0'),
      `${Math.max(1, now.getDate())}`.padStart(2, '0'),
    ].join('-');
    const restoration = { sourceUrl: '/', dateKey };
    dayDetailsNavigation.restorationFor.mockReturnValue(restoration);
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    const componentBottomSheet = (fixture.componentInstance as unknown as {
      bottomSheet: MatBottomSheet;
    }).bottomSheet;
    vi.spyOn(componentBottomSheet, 'open').mockImplementation(openBottomSheet);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dayDetailsNavigation.consumeRestoration).toHaveBeenCalledWith(restoration);
    expect(openBottomSheet).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({ day: expect.objectContaining({ dateKey }) }),
    }));
  });

  it('waits for a deleted event to leave the live day before restoring its remaining activities', async () => {
    const now = new Date();
    const eventDate = new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate()), 8);
    const dateKey = [
      eventDate.getFullYear(),
      `${eventDate.getMonth() + 1}`.padStart(2, '0'),
      `${eventDate.getDate()}`.padStart(2, '0'),
    ].join('-');
    const deletedEvent = createEvent(eventDate, 'event-1');
    const remainingEvent = createEvent(new Date(eventDate.getTime() + 60 * 60 * 1000), 'event-2');
    const events = new BehaviorSubject<EventInterface[]>([deletedEvent, remainingEvent]);
    watchEvents.mockReturnValue(events.asObservable());
    const restoration = { sourceUrl: '/', dateKey, deletedEventId: 'event-1' };
    dayDetailsNavigation.restorationFor.mockReturnValue(restoration);
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    const componentBottomSheet = (fixture.componentInstance as unknown as {
      bottomSheet: MatBottomSheet;
    }).bottomSheet;
    vi.spyOn(componentBottomSheet, 'open').mockImplementation(openBottomSheet);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(dayDetailsNavigation.consumeRestoration).not.toHaveBeenCalled();
    expect(openBottomSheet).not.toHaveBeenCalled();

    events.next([remainingEvent]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dayDetailsNavigation.consumeRestoration).toHaveBeenCalledWith(restoration);
    expect(openBottomSheet).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({
        day: expect.objectContaining({ events: [remainingEvent] }),
      }),
    }));
  });

  it('constrains the compact grid to the tile content area', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/activity-calendar-tile/activity-calendar-tile.component.scss'),
      'utf8',
    );
    const gridRule = styles.match(/app-activity-calendar-grid\s*\{([^}]*)\}/)?.[1];

    expect(gridRule).toContain('min-height: 0;');
    expect(gridRule).toContain('flex: 1 1 0;');
    expect(gridRule).toContain('overflow: hidden;');
  });
});

function createEvent(startDate?: Date, eventId = 'event-1'): EventInterface {
  const now = new Date();
  return {
    name: 'Morning run',
    startDate: startDate || new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate()), 8),
    getID: () => eventId,
    getActivityTypesAsArray: () => [ActivityTypes.Running],
    getActivityTypesAsString: () => 'Running',
    getStat: (type: string) => type === DataDuration.type ? { getValue: () => 3600 } : null,
  } as unknown as EventInterface;
}
