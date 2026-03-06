import { Injectable, inject } from '@angular/core';
import { AppWindowService } from './app.window.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';

@Injectable({
  providedIn: 'root'
})
export class AppHapticsService {
  private readonly compatibilityService = inject(BrowserCompatibilityService);
  private readonly windowService = inject(AppWindowService);

  public selection(): boolean {
    return this.trigger(8);
  }

  public success(): boolean {
    return this.trigger([10, 30, 20]);
  }

  public warning(): boolean {
    return this.trigger([20, 30, 20]);
  }

  public error(): boolean {
    return this.trigger([30, 40, 30, 40, 40]);
  }

  public trigger(pattern: number | number[]): boolean {
    if (!this.canTrigger()) {
      return false;
    }

    try {
      return this.windowService.windowRef.navigator.vibrate(pattern);
    } catch {
      return false;
    }
  }

  private canTrigger(): boolean {
    if (!this.compatibilityService.checkVibrationSupport()) {
      return false;
    }

    const reducedMotionQuery = this.windowService.windowRef.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (reducedMotionQuery?.matches) {
      return false;
    }

    const coarsePointerQuery = this.windowService.windowRef.matchMedia?.('(pointer: coarse)');
    if (coarsePointerQuery && !coarsePointerQuery.matches) {
      return false;
    }

    return true;
  }
}
