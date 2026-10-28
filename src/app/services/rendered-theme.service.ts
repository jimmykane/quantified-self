import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, NgZone, PLATFORM_ID, inject, signal } from '@angular/core';

/** Read-only display state. Observes the app's applied CSS theme without loading account/settings services. */
@Injectable({ providedIn: 'root' })
export class RenderedThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly dark = signal(this.document.body?.classList.contains('dark-theme') ?? false);
  readonly darkTheme = this.dark.asReadonly();

  constructor() {
    const destroyRef = inject(DestroyRef);
    const browser = isPlatformBrowser(inject(PLATFORM_ID));
    const Observer = this.document.defaultView?.MutationObserver;
    if (!browser || !Observer || !this.document.body) return;
    inject(NgZone).runOutsideAngular(() => {
      const observer = new Observer(() => this.dark.set(this.document.body.classList.contains('dark-theme')));
      observer.observe(this.document.body, { attributes: true, attributeFilter: ['class'] });
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
