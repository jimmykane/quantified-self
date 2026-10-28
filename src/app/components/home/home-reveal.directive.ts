import { Directive, DestroyRef, ElementRef, PLATFORM_ID, afterNextRender, inject, signal } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { BrowserCompatibilityService } from '../../services/browser.compatibility.service';

@Directive({
  selector: '[appHomeReveal]',
  standalone: true,
  host: { '[class.home-reveal-visible]': 'revealed()' },
})
export class HomeRevealDirective {
  readonly revealed = signal(false);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor() {
    // Content stays visible in SSR and without observer support. Only the first
    // viewport entry starts motion; large chart rows need no height threshold.
    afterNextRender(() => {
      if (!this.isBrowser || this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        || !BrowserCompatibilityService.checkIntersectionObserverSupport()) return;
      const observer = new IntersectionObserver(entries => {
        if (this.destroyRef.destroyed || this.revealed() || !entries.some(entry => entry.isIntersecting)) return;
        this.revealed.set(true);
        observer.disconnect();
      }, { threshold: 0 });
      this.destroyRef.onDestroy(() => observer.disconnect());
      observer.observe(this.element.nativeElement);
    });
  }
}
