import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, Scroll } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type { PublicSeoPage } from './public-seo-pages.content';
import { PublicTrainingCatalogComponent } from './public-training-catalog.component';
import { PublicFeaturePreviewComponent } from './public-feature-preview.component';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';

@Component({
  selector: 'app-public-seo-page',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, PublicFeaturePreviewComponent, PublicTrainingCatalogComponent, CompactRowComponent, AppChartSharedModule],
  templateUrl: './public-seo-page.component.html',
  styleUrls: ['./public-seo-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicSeoPageComponent {
  private readonly route = inject(ActivatedRoute);

  readonly page = this.route.snapshot.data['publicSeoPage'] as PublicSeoPage;

  constructor() {
    if (this.page.key !== 'trainingPlans' || !isPlatformBrowser(inject(PLATFORM_ID))) return;
    const document = inject(DOCUMENT);
    // The app scrolls inside its shell. Resolve catalog fragments after router scroll restoration.
    inject(Router).events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (!(event instanceof Scroll) || event.position || !event.anchor) return;
      const target = document.getElementById(event.anchor);
      if (!target?.matches('#free-training-plans, app-public-training-catalog h3[id]')) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'start' });
    });
  }
}
