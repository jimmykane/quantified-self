import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { CalendarDayDetailsNavigationService } from './calendar-day-details-navigation.service';

describe('CalendarDayDetailsNavigationService', () => {
  let routerEvents: Subject<unknown>;
  let service: CalendarDayDetailsNavigationService;

  beforeEach(() => {
    routerEvents = new Subject<unknown>();
    TestBed.configureTestingModule({
      providers: [
        CalendarDayDetailsNavigationService,
        { provide: Router, useValue: { events: routerEvents.asObservable() } },
      ],
    });
    service = TestBed.inject(CalendarDayDetailsNavigationService);
  });

  it('makes a calendar day restorable only after browser-back navigation', () => {
    expect(service.prepareReturn('/dashboard', '2026-08-20')).toBe(true);

    routerEvents.next(new NavigationStart(1, '/user/user-1/event/event-1', 'imperative'));
    expect(service.restorationFor('/dashboard')).toBeNull();

    routerEvents.next(new NavigationStart(2, '/dashboard', 'popstate'));
    const restoration = service.restorationFor('/dashboard');

    expect(restoration).toEqual({ sourceUrl: '/dashboard', dateKey: '2026-08-20' });
    expect(service.consumeRestoration(restoration!)).toBe(true);
    expect(service.restorationFor('/dashboard')).toBeNull();
  });

  it('preserves calendar query parameters when matching a full-calendar return', () => {
    const sourceUrl = '/calendar?view=month&date=2026-08-03';
    service.prepareReturn(sourceUrl, '2026-08-03');

    routerEvents.next(new NavigationStart(1, '/user/user-1/event/event-1', 'imperative'));
    routerEvents.next(new NavigationStart(2, sourceUrl, 'popstate'));

    expect(service.restorationFor(sourceUrl)?.dateKey).toBe('2026-08-03');
    expect(service.restorationFor('/calendar')).toBeNull();
  });

  it('carries a deleted event ID into the returning calendar restoration', () => {
    service.prepareReturn('/dashboard', '2026-08-20');
    routerEvents.next(new NavigationStart(1, '/user/user-1/event/event-1', 'imperative'));

    service.markEventDeleted('event-1');
    routerEvents.next(new NavigationStart(2, '/dashboard', 'popstate'));

    expect(service.restorationFor('/dashboard')).toEqual({
      sourceUrl: '/dashboard',
      dateKey: '2026-08-20',
      deletedEventId: 'event-1',
    });
  });

  it('clears the pending return when the user navigates elsewhere', () => {
    service.prepareReturn('/dashboard', '2026-08-20');

    routerEvents.next(new NavigationStart(1, '/user/user-1/event/event-1', 'imperative'));
    routerEvents.next(new NavigationStart(2, '/training', 'imperative'));
    routerEvents.next(new NavigationStart(3, '/dashboard', 'popstate'));

    expect(service.restorationFor('/dashboard')).toBeNull();
  });

  it('clears an unconsumed restoration when leaving its source page', () => {
    service.prepareReturn('/dashboard', '2026-08-20');
    routerEvents.next(new NavigationStart(1, '/user/user-1/event/event-1', 'imperative'));
    routerEvents.next(new NavigationStart(2, '/dashboard', 'popstate'));
    expect(service.restorationFor('/dashboard')).not.toBeNull();

    routerEvents.next(new NavigationStart(3, '/training', 'imperative'));

    expect(service.restorationFor('/dashboard')).toBeNull();
  });

  it('rejects invalid return URLs and date keys', () => {
    expect(service.prepareReturn('https://example.com', '2026-08-20')).toBe(false);
    expect(service.prepareReturn('/dashboard', 'August 20')).toBe(false);
    expect(service.prepareReturn('/dashboard', '2026-02-30')).toBe(false);
  });
});
