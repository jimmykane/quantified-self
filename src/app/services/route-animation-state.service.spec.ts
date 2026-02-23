import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { describe, it, expect, beforeEach } from 'vitest';
import { Subject } from 'rxjs';
import { RouteAnimationStateService } from './route-animation-state.service';

describe('RouteAnimationStateService', () => {
  let events$: Subject<unknown>;
  let mockRouter: Router;
  let service: RouteAnimationStateService;

  beforeEach(() => {
    events$ = new Subject<unknown>();
    mockRouter = {
      events: events$,
      routerState: {
        snapshot: {
          root: {
            data: { animation: 'Root' },
            firstChild: {
              data: { animation: 'Dashboard' },
              firstChild: null
            }
          }
        }
      }
    } as unknown as Router;

    TestBed.configureTestingModule({
      providers: [
        RouteAnimationStateService,
        { provide: Router, useValue: mockRouter }
      ]
    });

    service = TestBed.inject(RouteAnimationStateService);
  });

  it('starts with null animation state', () => {
    expect(service.animationState()).toBeNull();
  });

  it('suppresses animation on initial navigation end', () => {
    events$.next(new NavigationEnd(1, '/login', '/login'));

    expect(service.animationState()).toBeNull();
  });

  it('uses deepest route animation after initial navigation end', () => {
    events$.next(new NavigationEnd(1, '/login', '/login'));
    events$.next(new NavigationEnd(2, '/dashboard', '/dashboard'));

    expect(service.animationState()).toBe('Dashboard');
  });

  it('falls back to null when router snapshot is unavailable', () => {
    (mockRouter as unknown as { routerState?: unknown }).routerState = undefined;

    events$.next(new NavigationEnd(1, '/login', '/login'));
    events$.next(new NavigationEnd(2, '/dashboard', '/dashboard'));

    expect(service.animationState()).toBeNull();
  });
});
