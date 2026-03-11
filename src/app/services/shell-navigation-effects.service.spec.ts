import { TestBed } from '@angular/core/testing';
import {
  NavigationEnd,
  NavigationStart,
  Router,
} from '@angular/router';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Subject } from 'rxjs';
import { AppHapticsService } from './app.haptics.service';
import { ShellNavigationEffectsService } from './shell-navigation-effects.service';

describe('ShellNavigationEffectsService', () => {
  let events$: Subject<unknown>;
  let mockRouter: Router;
  let hapticsMock: { selection: ReturnType<typeof vi.fn> };
  let service: ShellNavigationEffectsService;
  let shellContainer: HTMLDivElement | null = null;

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
    hapticsMock = { selection: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        ShellNavigationEffectsService,
        { provide: Router, useValue: mockRouter },
        { provide: AppHapticsService, useValue: hapticsMock }
      ]
    });

    service = TestBed.inject(ShellNavigationEffectsService);
  });

  afterEach(() => {
    if (shellContainer) {
      shellContainer.remove();
      shellContainer = null;
    }
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

  it('triggers haptics only for imperative navigation after initial navigation', () => {
    events$.next(new NavigationEnd(1, '/dashboard', '/dashboard'));
    events$.next(new NavigationStart(2, '/help', 'imperative'));
    events$.next(new NavigationEnd(2, '/help', '/help'));

    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
  });

  it('does not trigger haptics for popstate navigation', () => {
    events$.next(new NavigationEnd(1, '/dashboard', '/dashboard'));
    events$.next(new NavigationStart(2, '/dashboard', 'popstate'));
    events$.next(new NavigationEnd(2, '/dashboard', '/dashboard'));

    expect(hapticsMock.selection).not.toHaveBeenCalled();
  });

  it('does not reset shell scroller or window scroll on initial navigation end', () => {
    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    shellContainer = document.createElement('div');
    shellContainer.className = 'app-sidenav-container';
    const drawerContent = document.createElement('div');
    drawerContent.className = 'mat-drawer-content';
    drawerContent.scrollTop = 120;
    drawerContent.scrollLeft = 30;
    shellContainer.appendChild(drawerContent);
    document.body.appendChild(shellContainer);

    events$.next(new NavigationEnd(1, '/dashboard', '/dashboard'));

    expect(drawerContent.scrollTop).toBe(120);
    expect(drawerContent.scrollLeft).toBe(30);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('resets shell scroller and window scroll on navigation end after initial navigation', () => {
    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    shellContainer = document.createElement('div');
    shellContainer.className = 'app-sidenav-container';
    const drawerContent = document.createElement('div');
    drawerContent.className = 'mat-drawer-content';
    drawerContent.scrollTop = 120;
    drawerContent.scrollLeft = 30;
    shellContainer.appendChild(drawerContent);
    document.body.appendChild(shellContainer);

    events$.next(new NavigationEnd(1, '/dashboard', '/dashboard'));
    events$.next(new NavigationEnd(1, '/dashboard', '/dashboard'));

    expect(drawerContent.scrollTop).toBe(0);
    expect(drawerContent.scrollLeft).toBe(0);
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('falls back to numeric scrollTo when options object is unsupported', () => {
    const scrollSpy = vi.spyOn(window, 'scrollTo' as any).mockImplementation((...args: any[]) => {
      if (typeof args[0] === 'object') {
        throw new Error('not supported');
      }
    });

    events$.next(new NavigationEnd(1, '/dashboard', '/dashboard'));
    events$.next(new NavigationEnd(1, '/dashboard', '/dashboard'));

    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });
});
