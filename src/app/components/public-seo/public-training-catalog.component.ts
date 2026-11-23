import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { PlanAttributionComponent } from '../plans/plan-attribution.component';
import {
  FEATURED_TRAINING_PLANS, PUBLIC_CATALOG_FRAGMENT, PUBLIC_TRAINING_PLANS,
  PUBLIC_TRAINING_PLANS_URL, publicPlanFragment,
} from './public-training-catalog.content';

@Component({
  selector: 'app-public-training-catalog',
  standalone: true,
  imports: [MatButtonModule, PlanAttributionComponent, RouterLink],
  templateUrl: './public-training-catalog.component.html',
  styleUrl: './public-training-catalog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicTrainingCatalogComponent {
  readonly full = input(false);
  readonly plans = PUBLIC_TRAINING_PLANS;
  readonly featured = FEATURED_TRAINING_PLANS;
  readonly credits = PUBLIC_TRAINING_PLANS.flatMap(plan => plan.attribution ? [plan.attribution] : []);
  readonly pageUrl = PUBLIC_TRAINING_PLANS_URL;
  readonly catalogFragment = PUBLIC_CATALOG_FRAGMENT;
  readonly planFragment = publicPlanFragment;
}
