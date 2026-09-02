import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { ServiceSourceIconComponent } from '../event-summary/service-source-icon/service-source-icon.component';
import { PublicFeaturePreviewComponent } from '../public-seo/public-feature-preview.component';
import {
  COMPARISON_ANALYSIS_ITEMS,
  COMPARISON_FAQ_ITEMS,
  COMPARISON_PROVIDER_SOURCES,
  COMPARISON_REVIEW_ITEMS,
  COMPARISON_SOURCE_ITEMS,
} from './workout-data-comparison-page.content';

@Component({
  selector: 'app-workout-data-comparison-page',
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatListModule,
    ServiceSourceIconComponent,
    PublicFeaturePreviewComponent,
  ],
  templateUrl: './workout-data-comparison-page.component.html',
  styleUrls: ['./workout-data-comparison-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkoutDataComparisonPageComponent {
  readonly providerSources = COMPARISON_PROVIDER_SOURCES;
  readonly sourceItems = COMPARISON_SOURCE_ITEMS;
  readonly analysisItems = COMPARISON_ANALYSIS_ITEMS;
  readonly reviewItems = COMPARISON_REVIEW_ITEMS;
  readonly faqItems = COMPARISON_FAQ_ITEMS;
}
