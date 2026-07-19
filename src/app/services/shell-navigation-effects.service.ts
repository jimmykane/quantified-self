import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  private static readonly ROUTE_ANIMATION_DISABLED_STATE = 'RouteAnimationDisabled';

  private readonly destroyRef = inject(DestroyRef);
  private readonly documentRef = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly hapticsService = inject(AppHapticsService);

  private readonly animationStateSignal = signal<string | null>(null);
  readonly animationState = this.animationStateSignal.asReadonly();

  private readonly navigationEndSubject = new Subject<void>();
  readonly navigationEnd$ = this.navigationEndSubject.asObservable();

  private hasSeenInitialNavigationEnd = false;
  private hasCompletedInitialNavigation = false;
  private shouldTriggerNavigationHaptics = false;
  private shellScroller: HTMLElement | null = null;
  private lastNavigationPath: string | null = null;

  setShellScroller(shellScroller: HTMLElement | null): void {
    this.shellScroller = shellScroller;
  }

  constructor() {
    this.router.events
      .pipe(
        takeUntilDestroyed(this.destroyRef),
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
          if (this.hasCompletedInitialNavigation && this.hasNavigationPathChanged(event.url)) {
            this.resetScrollPosition();
          }
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
        const hasNavigationPathChanged = this.hasNavigationPathChanged(event.urlAfterRedirects);
        this.lastNavigationPath = this.readNavigationPath(event.urlAfterRedirects);
        const isInitialNavigationEnd = this.updateAnimationState();
        if (!isInitialNavigationEnd && hasNavigationPathChanged) {
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

    let currentRoute: typeof rootRoute | null = rootRoute;
    let animationState: string | null = null;
    let disableRouteAnimation = false;

    while (currentRoute) {
      if (currentRoute.data?.['disableRouteAnimation'] === true) {
        disableRouteAnimation = true;
      }
      if (typeof currentRoute.data?.['animation'] === 'string') {
        animationState = currentRoute.data['animation'];
      }
      currentRoute = currentRoute.firstChild;
    }

    return disableRouteAnimation
      ? ShellNavigationEffectsService.ROUTE_ANIMATION_DISABLED_STATE
      : animationState;
  }

  private resetScrollPosition(): void {
    const windowRef = this.documentRef.defaultView;
    if (!windowRef) {
      return;
    }

    const shellScroller = this.shellScroller;
    if (shellScroller) {
      shellScroller.scrollTop = 0;
      shellScroller.scrollLeft = 0;
    }

    try {
      windowRef.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch {
      windowRef.scrollTo(0, 0);
    }
  }

  private hasNavigationPathChanged(url: string): boolean {
    const nextPath = this.readNavigationPath(url);
    return this.lastNavigationPath !== null && this.lastNavigationPath !== nextPath;
  }

  private readNavigationPath(url: string): string {
    return url.split(/[?#]/, 1)[0] || '/';
  }
}
