import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SharedModule } from '../../modules/shared.module';
import {
  COMPARISON_FAQ_ITEMS,
  COMPARISON_FEATURE_ITEMS,
  COMPARISON_PROVIDER_SOURCES,
  COMPARISON_SEARCH_INTENT_ITEMS,
} from './workout-data-comparison-page.content';

@Component({
  selector: 'app-workout-data-comparison-page',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './workout-data-comparison-page.component.html',
  styleUrls: ['./workout-data-comparison-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkoutDataComparisonPageComponent {
  readonly providerSources = COMPARISON_PROVIDER_SOURCES;
  readonly featureItems = COMPARISON_FEATURE_ITEMS;
  readonly searchIntentItems = COMPARISON_SEARCH_INTENT_ITEMS;
  readonly faqItems = COMPARISON_FAQ_ITEMS;
}
