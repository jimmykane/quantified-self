import { Directive, ElementRef, HostListener, Input, inject } from '@angular/core';
import { AppHapticsService } from '../services/app.haptics.service';

type HapticTapMode = 'selection' | 'success' | 'warning' | 'error';

@Directive({
  selector: '[appHapticTap]',
  standalone: false,
})
export class HapticTapDirective {
  private readonly hapticsService = inject(AppHapticsService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  @Input('appHapticTap') mode: HapticTapMode | '' | null | undefined = 'selection';
  @Input() appHapticTapDisabled = false;

  @HostListener('click')
  onHostClick(): void {
    if (this.appHapticTapDisabled || this.isHostDisabled()) {
      return;
    }

    switch (this.resolveMode()) {
      case 'success':
        this.hapticsService.success();
        return;
      case 'warning':
        this.hapticsService.warning();
        return;
      case 'error':
        this.hapticsService.error();
        return;
      default:
        this.hapticsService.selection();
    }
  }

  private resolveMode(): HapticTapMode {
    const normalizedMode = `${this.mode || ''}`.trim().toLowerCase();
    if (
      normalizedMode === 'success'
      || normalizedMode === 'warning'
      || normalizedMode === 'error'
    ) {
      return normalizedMode;
    }
    return 'selection';
  }

  private isHostDisabled(): boolean {
    const host = this.elementRef.nativeElement as HTMLElement & { disabled?: boolean };
    if (host?.disabled === true) {
      return true;
    }
    return host?.getAttribute?.('aria-disabled') === 'true';
  }
}
