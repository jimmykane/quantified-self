import { Component, OnInit, DestroyRef, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MAT_TOOLTIP_DEFAULT_OPTIONS, MatTooltipModule } from '@angular/material/tooltip';
import { ASSISTANT_REQUEST_LIMITS, ROUTE_USAGE_LIMITS, USAGE_LIMITS } from '@shared/limits';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { getNumberFormatter } from '../../helpers/number-format.helper';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { PublicFeaturePreviewComponent } from '../public-seo/public-feature-preview.component';
import { HEALTH_FEATURE_CONTENT } from '../public-seo/health-feature.content';
import { TRAINING_PLANS_HOME_CONTENT } from '../public-seo/training-plans-home.content';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatIconModule, MatTooltipModule,
    AppChartSharedModule, PublicFeaturePreviewComponent, CompactRowComponent],
  providers: [{ provide: MAT_TOOLTIP_DEFAULT_OPTIONS, useValue: {
    showDelay: 0, hideDelay: 0, touchendHideDelay: 1500, touchGestures: 'off',
  } }],
})
export class HomeComponent implements OnInit {
  private readonly authService = inject(AppAuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly haptics = inject(AppHapticsService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly expandedFaq = signal<string | null>(null);
  readonly healthFeature = HEALTH_FEATURE_CONTENT;
  readonly trainingPlansFeature = TRAINING_PLANS_HOME_CONTENT;
  readonly memberships = [
    { name: 'Starter', label: 'Free', copy: 'A place to begin.', route: '/login', action: 'Start free',
      features: [`Up to ${getNumberFormatter().format(USAGE_LIMITS.free)} activities`,
        `Up to ${getNumberFormatter().format(ROUTE_USAGE_LIMITS.free)} saved routes`, 'Plans and standalone workouts'] },
    { name: 'Basic', label: 'More history', copy: 'For consistent training.', route: '/pricing', action: 'Explore Basic',
      features: [`Up to ${getNumberFormatter().format(USAGE_LIMITS.basic)} activities`,
        `Up to ${getNumberFormatter().format(ROUTE_USAGE_LIMITS.basic)} saved routes`,
        `Up to ${getNumberFormatter().format(ASSISTANT_REQUEST_LIMITS.basic)} Assistant requests per billing period`] },
    { name: 'Pro', label: 'Keep it connected', copy: 'For your complete workflow.', route: '/pricing', action: 'Explore Pro',
      features: ['Unlimited activities and routes', 'Supported cross-provider sync', 'Compatible workout delivery'] },
  ];
  readonly faqs = [
    { id: 'watch', question: 'Can I start without a watch?',
      answer: 'Yes. Upload your own FIT, TCX, GPX, JSON, or SML activity files. A connected watch is optional.' },
    { id: 'history', question: 'Can I bring my existing activity history?',
      answer: 'Import files yourself, or connect a supported provider with Pro to import the activity history available from that service.' },
    { id: 'free', question: 'What can I do for free?',
      answer: `Starter includes up to ${USAGE_LIMITS.free} activities and ${ROUTE_USAGE_LIMITS.free} saved routes, with training analysis, plans, and standalone workouts. See membership for the full comparison.` },
    { id: 'devices', question: 'Which devices can receive planned workouts?',
      answer: 'Pro supports compatible workout delivery to Garmin, Suunto, and Wahoo. Compatibility depends on the workout and destination; review the Training Plans overview for details.' },
    { id: 'exports', question: 'Can I export my original activity files?',
      answer: 'Yes. Download your original activity files for a backup, a change of service, or analysis elsewhere.' },
  ];

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.authService.user$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(user => {
      if (user) void this.router.navigate(['/dashboard']);
    });
  }

  toggleFaq(id: string): void {
    if (!this.faqs.some(faq => faq.id === id)) return;
    this.expandedFaq.update(current => current === id ? null : id);
    this.haptics.selection();
  }
}
