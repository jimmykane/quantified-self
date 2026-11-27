import { AppHapticsService } from '../../services/app.haptics.service';
import { DeferredLoadErrorComponent } from '../shared/deferred-load-error/deferred-load-error.component';
import { PublicPlanWeekComponent } from './public-plan-week.component';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
  imports: [RouterLink, MatButtonModule, MatIconModule, PublicFeaturePreviewComponent, PublicTrainingCatalogComponent, CompactRowComponent, AppChartSharedModule,
    PublicPlanWeekComponent, DeferredLoadErrorComponent],
  templateUrl: './public-seo-page.component.html',
  styleUrls: ['./public-seo-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicSeoPageComponent {
  private readonly route = inject(ActivatedRoute);

  private readonly haptics = inject(AppHapticsService);
  readonly expandedPlan = signal<string | null>(null);

  readonly page = this.route.snapshot.data['publicSeoPage'] as PublicSeoPage;

  toggleWeek(id: string): void {
    this.expandedPlan.update(current => current === id ? null : id);
    this.haptics.selection();
  }
}
