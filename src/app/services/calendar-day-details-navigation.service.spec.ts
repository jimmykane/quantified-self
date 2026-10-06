import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationCancel, NavigationEnd, NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AppUserService } from './app.user.service';
import { CalendarDayDetailsNavigationService } from './calendar-day-details-navigation.service';

describe('CalendarDayDetailsNavigationService', () => {
  let routerEvents: Subject<unknown>;
  let currentUser: ReturnType<typeof signal<{ uid: string } | null>>;
  let service: CalendarDayDetailsNavigationService;

  beforeEach(() => {
    routerEvents = new Subject<unknown>();
    currentUser = signal({ uid: 'owner' });
    TestBed.configureTestingModule({
      providers: [
        CalendarDayDetailsNavigationService,
        { provide: Router, useValue: { events: routerEvents.asObservable() } },
        { provide: AppUserService, useValue: { user: currentUser } },
      ],
    });
    service = TestBed.inject(CalendarDayDetailsNavigationService);
  });

  it('opens a duplicated workout day once for the same owner and rejects stale or foreign destinations', () => {
    expect(service.prepareWorkoutDestination('owner', '2027-01-02')).toBe(true);
    expect(service.workoutDestinationFor('owner')).toBe('2027-01-02');
    expect(service.consumeWorkoutDestination('owner', '2027-01-01')).toBe(false);
    expect(service.consumeWorkoutDestination('owner', '2027-01-02')).toBe(true);
    expect(service.workoutDestinationFor('owner')).toBeNull();
    expect(service.prepareWorkoutDestination('owner', '2027-02-30')).toBe(false);
    service.prepareWorkoutDestination('owner', '2027-01-03');
    expect(service.workoutDestinationFor('other')).toBeNull();
    expect(service.workoutDestinationFor('owner')).toBeNull();
  });

  it('forgets an unconsumed duplicate destination on sign-out, even if the same account returns', () => {
    service.prepareWorkoutDestination('owner', '2027-01-02');
    TestBed.tick();
    currentUser.set(null);
    TestBed.tick();
    currentUser.set({ uid: 'owner' });
    TestBed.tick();
    expect(service.workoutDestinationFor('owner')).toBeNull();
  });

  it('makes a calendar day restorable after returning to its origin', () => {
    expect(service.prepareReturn('/dashboard', '2026-08-20')).toBe(true);

    routerEvents.next(new NavigationStart(1, '/user/user-1/event/event-1', 'imperative'));
    routerEvents.next(new NavigationEnd(1, '/user/user-1/event/event-1', '/user/user-1/event/event-1'));
    expect(service.restorationFor('/dashboard')).toBeNull();

    routerEvents.next(new NavigationStart(2, '/dashboard', 'popstate'));
    routerEvents.next(new NavigationEnd(2, '/dashboard', '/dashboard'));
    const restoration = service.restorationFor('/dashboard');

    expect(restoration).toEqual({ sourceUrl: '/dashboard', dateKey: '2026-08-20' });
    expect(service.consumeRestoration(restoration!)).toBe(true);
    expect(service.restorationFor('/dashboard')).toBeNull();
  });

  it('retains the selected Calendar period across a library visit and recipe editor until Back', () => {
    const calendarReturn = { view: 'month' as const, anchor: '2026-10-01' };
    service.prepareReturn('/calendar', '2026-10-25', undefined, calendarReturn);
    for (const [index, url] of ['/training/plans/library?date=2026-10-25',
      '/training/plans/library/saved-run?date=2026-10-25', '/training/plans/library?date=2026-10-25'].entries()) {
      routerEvents.next(new NavigationStart(index + 1, url, 'imperative'));
      routerEvents.next(new NavigationEnd(index + 1, url, url));
    }
    routerEvents.next(new NavigationStart(4, '/calendar', 'popstate'));
    routerEvents.next(new NavigationEnd(4, '/calendar', '/calendar'));
    expect(service.restorationFor('/calendar')).toEqual({ sourceUrl: '/calendar', dateKey: '2026-10-25', calendarReturn });
  });

  it('publishes the return only after the destination URL and its components are active', () => {
    service.prepareReturn('/dashboard', '2026-09-17', undefined, { view: 'month', anchor: '2026-09-01' });
    routerEvents.next(new NavigationStart(1, '/dashboard', 'imperative'));
    TestBed.tick();
    expect(service.restorationFor('/dashboard')).toBeNull();

    routerEvents.next(new NavigationEnd(1, '/dashboard', '/dashboard'));
    expect(service.restorationFor('/dashboard')?.dateKey).toBe('2026-09-17');
  });

  it('keeps a cancelled return pending until a retry completes', () => {
    service.prepareReturn('/dashboard', '2026-09-17');
    routerEvents.next(new NavigationStart(1, '/dashboard', 'imperative'));
    routerEvents.next(new NavigationCancel(1, '/dashboard', 'cancelled'));
    expect(service.restorationFor('/dashboard')).toBeNull();
    routerEvents.next(new NavigationStart(2, '/dashboard', 'imperative'));
    routerEvents.next(new NavigationEnd(2, '/dashboard', '/dashboard'));
    expect(service.restorationFor('/dashboard')?.dateKey).toBe('2026-09-17');
  });

  it('withholds a completed return if the owner changed before effects run', () => {
    service.prepareReturn('/dashboard', '2026-09-17');
    routerEvents.next(new NavigationStart(1, '/dashboard', 'imperative'));
    currentUser.set({ uid: 'other' });
    routerEvents.next(new NavigationEnd(1, '/dashboard', '/dashboard'));
    expect(service.restorationFor('/dashboard')).toBeNull();
  });

  it('restores the dashboard selection after visiting a full day and using browser Back', () => {
    expect(service.prepareReturn('/dashboard', '2026-08-20')).toBe(true);
    routerEvents.next(new NavigationStart(1, '/calendar/day/2026-08-20', 'imperative'));
    routerEvents.next(new NavigationEnd(1, '/calendar/day/2026-08-20', '/calendar/day/2026-08-20'));
    expect(service.restorationFor('/dashboard')).toBeNull();

    routerEvents.next(new NavigationStart(2, '/dashboard', 'popstate'));
    routerEvents.next(new NavigationEnd(2, '/dashboard', '/dashboard'));
    expect(service.restorationFor('/dashboard')).toEqual({ sourceUrl: '/dashboard', dateKey: '2026-08-20' });
  });

  it('retains the Today sheet origin when returning from a full day', () => {
    expect(service.prepareReturn('/dashboard', '2026-08-20', 'today-sheet')).toBe(true);
    routerEvents.next(new NavigationStart(1, '/calendar/day/2026-08-20', 'imperative'));
    routerEvents.next(new NavigationEnd(1, '/calendar/day/2026-08-20', '/calendar/day/2026-08-20'));
    routerEvents.next(new NavigationStart(2, '/dashboard', 'popstate'));
    routerEvents.next(new NavigationEnd(2, '/dashboard', '/dashboard'));

    const restoration = service.restorationFor('/dashboard');
    expect(restoration).toEqual({ sourceUrl: '/dashboard', dateKey: '2026-08-20', surface: 'today-sheet' });
    expect(service.consumeRestoration(restoration!)).toBe(true);
  });

  it('preserves calendar query parameters when matching a full-calendar return', () => {
    const sourceUrl = '/calendar?view=month&date=2026-08-03';
    service.prepareReturn(sourceUrl, '2026-08-03');

    routerEvents.next(new NavigationStart(1, '/user/user-1/event/event-1', 'imperative'));
    routerEvents.next(new NavigationEnd(1, '/user/user-1/event/event-1', '/user/user-1/event/event-1'));
    routerEvents.next(new NavigationStart(2, sourceUrl, 'popstate'));
    routerEvents.next(new NavigationEnd(2, sourceUrl, sourceUrl));

    expect(service.restorationFor(sourceUrl)?.dateKey).toBe('2026-08-03');
    expect(service.restorationFor('/calendar')).toBeNull();
  });

  it.each([
    '/training/plans/workout/workout-1',
    '/training/plans/new?date=2026-08-03',
    '/training/plans/standalone/new?date=2026-08-03',
    '/training/plans/plan/plan-1/new?date=2026-08-03',
  ])('keeps the calendar return pending while visiting workout editor path %s', targetUrl => {
    service.prepareReturn('/calendar?view=month&date=2026-08-03', '2026-08-03');

    routerEvents.next(new NavigationStart(1, targetUrl, 'imperative'));
    routerEvents.next(new NavigationEnd(1, targetUrl, targetUrl));
    routerEvents.next(new NavigationStart(2, '/calendar?view=month&date=2026-08-03', 'popstate'));
    routerEvents.next(new NavigationEnd(2, '/calendar?view=month&date=2026-08-03', '/calendar?view=month&date=2026-08-03'));

    expect(service.restorationFor('/calendar?view=month&date=2026-08-03')?.dateKey).toBe('2026-08-03');
  });

  it('keeps the calendar return after a saved workout replaces its editor with the destination plan', () => {
    const sourceUrl = '/calendar?view=month&date=2026-08-03';
    service.prepareReturn(sourceUrl, '2026-08-03');

    routerEvents.next(new NavigationStart(1, '/training/plans/workout/workout-1', 'imperative'));
    routerEvents.next(new NavigationEnd(1, '/training/plans/workout/workout-1', '/training/plans/workout/workout-1'));
    routerEvents.next(new NavigationStart(2, '/training/plans/plan/plan-1?date=2026-08-03', 'imperative'));
    routerEvents.next(new NavigationEnd(2, '/training/plans/plan/plan-1?date=2026-08-03', '/training/plans/plan/plan-1?date=2026-08-03'));
    routerEvents.next(new NavigationStart(3, sourceUrl, 'popstate'));
    routerEvents.next(new NavigationEnd(3, sourceUrl, sourceUrl));

    expect(service.restorationFor(sourceUrl)?.dateKey).toBe('2026-08-03');
  });

  it('does not treat removed query-parameter editor links as workout paths', () => {
    service.prepareReturn('/calendar', '2026-08-03');

    routerEvents.next(new NavigationStart(1, '/training/plans?workout=workout-1', 'imperative'));
    routerEvents.next(new NavigationEnd(1, '/training/plans?workout=workout-1', '/training/plans?workout=workout-1'));
    routerEvents.next(new NavigationStart(2, '/calendar', 'popstate'));
    routerEvents.next(new NavigationEnd(2, '/calendar', '/calendar'));

    expect(service.restorationFor('/calendar')).toBeNull();
  });

  it('carries a deleted event ID into the returning calendar restoration', () => {
    service.prepareReturn('/dashboard', '2026-08-20');
    routerEvents.next(new NavigationStart(1, '/user/user-1/event/event-1', 'imperative'));
    routerEvents.next(new NavigationEnd(1, '/user/user-1/event/event-1', '/user/user-1/event/event-1'));

    service.markEventDeleted('event-1');
    routerEvents.next(new NavigationStart(2, '/dashboard', 'popstate'));
    routerEvents.next(new NavigationEnd(2, '/dashboard', '/dashboard'));

    expect(service.restorationFor('/dashboard')).toEqual({
      sourceUrl: '/dashboard',
      dateKey: '2026-08-20',
      deletedEventId: 'event-1',
    });
  });

  it('clears the pending return when the user navigates elsewhere', () => {
    service.prepareReturn('/dashboard', '2026-08-20');

    routerEvents.next(new NavigationStart(1, '/user/user-1/event/event-1', 'imperative'));
    routerEvents.next(new NavigationEnd(1, '/user/user-1/event/event-1', '/user/user-1/event/event-1'));
    routerEvents.next(new NavigationStart(2, '/training', 'imperative'));
    routerEvents.next(new NavigationEnd(2, '/training', '/training'));
    routerEvents.next(new NavigationStart(3, '/dashboard', 'popstate'));
    routerEvents.next(new NavigationEnd(3, '/dashboard', '/dashboard'));

    expect(service.restorationFor('/dashboard')).toBeNull();
  });

  it('clears an unconsumed restoration when leaving its source page', () => {
    service.prepareReturn('/dashboard', '2026-08-20');
    routerEvents.next(new NavigationStart(1, '/user/user-1/event/event-1', 'imperative'));
    routerEvents.next(new NavigationEnd(1, '/user/user-1/event/event-1', '/user/user-1/event/event-1'));
    routerEvents.next(new NavigationStart(2, '/dashboard', 'popstate'));
    routerEvents.next(new NavigationEnd(2, '/dashboard', '/dashboard'));
    expect(service.restorationFor('/dashboard')).not.toBeNull();

    routerEvents.next(new NavigationStart(3, '/training', 'imperative'));
    routerEvents.next(new NavigationEnd(3, '/training', '/training'));

    expect(service.restorationFor('/dashboard')).toBeNull();
  });

  it('restores mode and anchor through an explicit Dashboard return and clears them on account changes', () => {
    const period = { view: '30d' as const, anchor: '2026-08-15' };
    service.prepareReturn('/dashboard', '2026-08-03', undefined, period);
    routerEvents.next(new NavigationStart(1, '/calendar/day/2026-08-03?from=dashboard', 'imperative'));
    routerEvents.next(new NavigationEnd(1, '/calendar/day/2026-08-03?from=dashboard', '/calendar/day/2026-08-03?from=dashboard'));
    routerEvents.next(new NavigationStart(2, '/dashboard', 'imperative'));
    routerEvents.next(new NavigationEnd(2, '/dashboard', '/dashboard'));
    expect(service.restorationFor('/dashboard')?.calendarReturn).toEqual(period);
    TestBed.tick(); currentUser.set({ uid: 'other' }); TestBed.tick();
    expect(service.restorationFor('/dashboard')).toBeNull();
  });

  it('rejects invalid return URLs and date keys', () => {
    expect(service.prepareReturn('https://example.com', '2026-08-20')).toBe(false);
    expect(service.prepareReturn('/dashboard', 'August 20')).toBe(false);
    expect(service.prepareReturn('/dashboard', '2026-02-30')).toBe(false);
  });
});
