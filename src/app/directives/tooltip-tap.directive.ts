import { Directive, HostListener, Input, OnDestroy, inject } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { AppWindowService } from '../services/app.window.service';

@Directive({
  selector: '[appTooltipTap]',
  standalone: false,
})
export class TooltipTapDirective implements OnDestroy {
  private readonly tooltip = inject(MatTooltip, { optional: true, host: true });
  private readonly windowService = inject(AppWindowService);
  private hideTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly defaultHideDelayMs = 2200;

  @Input() appTooltipTapHideDelayMs = this.defaultHideDelayMs;

  @HostListener('click')
  onHostClick(): void {
    if (!this.shouldHandleTap()) {
      return;
    }
    if (!this.tooltip || this.isTooltipMessageMissing()) {
      return;
    }

    this.tooltip.show(0);
    this.clearHideTimer();
    this.hideTimeoutId = setTimeout(() => {
      this.tooltip?.hide(0);
      this.hideTimeoutId = null;
    }, this.resolveHideDelayMs());
  }

  ngOnDestroy(): void {
    this.clearHideTimer();
  }

  private shouldHandleTap(): boolean {
    try {
      const coarsePointerMediaQuery = this.windowService.windowRef.matchMedia?.('(pointer: coarse)');
      return coarsePointerMediaQuery?.matches === true;
    } catch {
      return false;
    }
  }

  private isTooltipMessageMissing(): boolean {
    return `${this.tooltip?.message || ''}`.trim().length === 0;
  }

  private resolveHideDelayMs(): number {
    const parsedDelayMs = Number(this.appTooltipTapHideDelayMs);
    if (!Number.isFinite(parsedDelayMs) || parsedDelayMs < 0) {
      return this.defaultHideDelayMs;
    }
    return parsedDelayMs;
  }

  private clearHideTimer(): void {
    if (this.hideTimeoutId === null) {
      return;
    }
    clearTimeout(this.hideTimeoutId);
    this.hideTimeoutId = null;
  }
}

