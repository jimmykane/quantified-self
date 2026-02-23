import { Injectable, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class RouteAnimationStateService {
  private readonly animationStateSignal = signal<string | null>(null);
  private hasSeenInitialNavigationEnd = false;

  readonly animationState = this.animationStateSignal.asReadonly();

  constructor(private router: Router) {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => {
        if (!this.hasSeenInitialNavigationEnd) {
          this.hasSeenInitialNavigationEnd = true;
          // Suppress the initial route transition animation.
          this.animationStateSignal.set(null);
          return;
        }

        this.animationStateSignal.set(this.readCurrentAnimationFromSnapshot());
      });
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
}
