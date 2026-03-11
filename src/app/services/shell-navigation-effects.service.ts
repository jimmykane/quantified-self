import { Injectable, inject, signal } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';
import { Subject } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AppHapticsService } from './app.haptics.service';

@Injectable({ providedIn: 'root' })
export class ShellNavigationEffectsService {
  private readonly router = inject(Router);
  private readonly hapticsService = inject(AppHapticsService);

  private readonly animationStateSignal = signal<string | null>(null);
  readonly animationState = this.animationStateSignal.asReadonly();

  private readonly navigationEndSubject = new Subject<void>();
  readonly navigationEnd$ = this.navigationEndSubject.asObservable();

  private hasSeenInitialNavigationEnd = false;
  private hasCompletedInitialNavigation = false;
  private shouldTriggerNavigationHaptics = false;

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationStart | NavigationCancel | NavigationError | NavigationEnd =>
          event instanceof NavigationStart ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError ||
          event instanceof NavigationEnd
        )
      )
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          this.shouldTriggerNavigationHaptics =
            this.hasCompletedInitialNavigation && event.navigationTrigger === 'imperative';
          return;
        }

        if (event instanceof NavigationCancel || event instanceof NavigationError) {
          this.shouldTriggerNavigationHaptics = false;
          return;
        }

        if (this.shouldTriggerNavigationHaptics) {
          this.hapticsService.selection();
        }

        this.shouldTriggerNavigationHaptics = false;
        this.hasCompletedInitialNavigation = true;
        const isInitialNavigationEnd = this.updateAnimationState();
        if (!isInitialNavigationEnd) {
          this.resetScrollPosition();
        }
        this.navigationEndSubject.next();
      });
  }

  private updateAnimationState(): boolean {
    if (!this.hasSeenInitialNavigationEnd) {
      this.hasSeenInitialNavigationEnd = true;
      // Suppress the initial route transition animation.
      this.animationStateSignal.set(null);
      return true;
    }

    this.animationStateSignal.set(this.readCurrentAnimationFromSnapshot());
    return false;
  }

  private readCurrentAnimationFromSnapshot(): string | null {
    const rootRoute = this.router.routerState?.snapshot?.root;
    if (!rootRoute) {
      return null;
    }

    let currentRoute = rootRoute;
    while (currentRoute.firstChild) {
      currentRoute = currentRoute.firstChild;
    }

    return currentRoute.data?.['animation'] ?? null;
  }

  private resetScrollPosition(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const shellScroller = document.querySelector('.app-sidenav-container .mat-drawer-content') as HTMLElement | null;
    if (shellScroller) {
      shellScroller.scrollTop = 0;
      shellScroller.scrollLeft = 0;
    }

    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch {
      window.scrollTo(0, 0);
    }
  }
}
