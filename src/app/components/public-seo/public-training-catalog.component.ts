import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, ElementRef, PLATFORM_ID, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { AppHapticsService } from '../../services/app.haptics.service';
import { DeferredLoadErrorComponent } from '../shared/deferred-load-error/deferred-load-error.component';
import { PublicPlanWeekComponent } from './public-plan-week.component';
import { Router, RouterLink, Scroll } from '@angular/router';
import { PlanAttributionComponent } from '../plans/plan-attribution.component';
import {
  FEATURED_TRAINING_PLANS, PUBLIC_CATALOG_FRAGMENT, PUBLIC_TRAINING_PLANS,
  PUBLIC_TRAINING_PLANS_URL, publicPlanFragment,
} from './public-training-catalog.content';

@Component({
  selector: 'app-public-training-catalog',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatIconModule, PlanAttributionComponent, RouterLink,
    PublicPlanWeekComponent, DeferredLoadErrorComponent],
  templateUrl: './public-training-catalog.component.html',
  styleUrl: './public-training-catalog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicTrainingCatalogComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly haptics = inject(AppHapticsService);
  readonly expandedPlan = signal<string | null>(null);
  readonly full = input(false);
  readonly returnLinkRestored = output<void>();
  readonly plans = PUBLIC_TRAINING_PLANS;
  readonly featured = FEATURED_TRAINING_PLANS;
  readonly pageUrl = PUBLIC_TRAINING_PLANS_URL;
  readonly catalogFragment = PUBLIC_CATALOG_FRAGMENT;
  readonly planFragment = publicPlanFragment;

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    inject(Router).events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (!(event instanceof Scroll)) return;
      // Angular saves the window position. The catalog lives inside a separately scrolling shell.
      if (event.position) {
        if (event.position.some(offset => offset !== 0) || !this.host.closest('mat-sidenav-content')) return;
        const href: unknown = this.host.ownerDocument.defaultView?.history.state?.qsPublicCatalogLink;
        const link = typeof href === 'string' && Array.from(this.host.querySelectorAll('a')).find(a => a.getAttribute('href') === href);
        if (link) {
          this.returnLinkRestored.emit();
          link.focus({ preventScroll: true });
          link.scrollIntoView({ block: 'center' });
          return;
        }
      }
      if (!this.full() || !event.anchor) return;
      const heading = event.anchor === PUBLIC_CATALOG_FRAGMENT
        ? this.host.closest('section')?.querySelector<HTMLElement>('h2')
        : Array.from(this.host.querySelectorAll<HTMLElement>('h3[id]')).find(element => element.id === event.anchor);
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'start' });
    });
  }

  toggleWeek(id: string): void {
    this.expandedPlan.update(current => current === id ? null : id);
    this.haptics.selection();
  }

  rememberLink(event: MouseEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.currentTarget as HTMLAnchorElement;
    const history = this.host.ownerDocument.defaultView?.history;
    // Keep the return target on the originating entry, including when sign-in redirects the destination.
    history?.replaceState({ ...history.state, qsPublicCatalogLink: link.getAttribute('href') }, '');
  }
}
