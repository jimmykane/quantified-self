import { Component, OnInit, DestroyRef, PLATFORM_ID, afterEveryRender, computed, inject, signal } from '@angular/core';
import { DOCUMENT, Location, isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MAT_TOOLTIP_DEFAULT_OPTIONS, MatTooltipModule } from '@angular/material/tooltip';
import { ASSISTANT_REQUEST_LIMITS, ROUTE_USAGE_LIMITS, USAGE_LIMITS } from '@shared/limits';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { getNumberFormatter } from '../../helpers/number-format.helper';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { PublicFeaturePreviewComponent } from '../public-seo/public-feature-preview.component';
import { HEALTH_FEATURE_CONTENT } from '../public-seo/health-feature.content';
import { TRAINING_PLANS_HOME_CONTENT } from '../public-seo/training-plans-home.content';

const HOME_FEATURES = [
  { id: 'training', label: 'Training' },
  { id: 'workouts', label: 'Workouts' },
  { id: 'plans', label: 'Plans' },
  { id: 'health', label: 'Health' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'maps', label: 'Maps' },
  { id: 'comparisons', label: 'Comparisons' },
  { id: 'integrations', label: 'Integrations' },
] as const;
type HomeFeatureId = typeof HOME_FEATURES[number]['id'];

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatIconModule, MatTooltipModule,
    MatFormFieldModule, MatSelectModule, MatTabsModule,
    PublicFeaturePreviewComponent, CompactRowComponent],
  providers: [{ provide: MAT_TOOLTIP_DEFAULT_OPTIONS, useValue: {
    showDelay: 0, hideDelay: 0, touchendHideDelay: 1500, touchGestures: 'off',
  } }],
})
export class HomeComponent implements OnInit {
  private readonly authService = inject(AppAuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly haptics = inject(AppHapticsService);
  private readonly location = inject(Location);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private featureScrollFrame: number | null = null;
  private featureScrollPending = false;
  readonly hasFeatureSelection = signal(false);
  private readonly featureScroll = afterEveryRender(() => this.flushFeatureScroll());
  readonly features = HOME_FEATURES;
  readonly selectedFeature = signal<HomeFeatureId>('training');
  readonly selectedFeatureLabel = computed(() => this.features.find(feature => feature.id === this.selectedFeature())!.label);
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
    this.syncFeatureFromUrl(this.location.path(true));
    this.destroyRef.onDestroy(this.location.onUrlChange(url => this.syncFeatureFromUrl(url)));
    this.destroyRef.onDestroy(() => this.cancelFeatureScrollFrame());
    this.authService.user$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(user => {
      if (user) void this.router.navigate(['/dashboard']);
    });
  }

  selectFeature(id: string, event?: MouseEvent): void {
    // Let modified links open their shareable feature URL in another tab.
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0)) return;
    event?.preventDefault();
    const feature = this.features.find(candidate => candidate.id === id);
    if (!feature) return;
    this.hasFeatureSelection.set(true);
    if (feature.id === this.selectedFeature()) {
      this.scrollToFeature();
      return;
    }
    this.selectedFeature.set(feature.id);
    this.haptics.selection();
    const path = this.location.path(true).split('#')[0];
    this.location.go(`${path}#home-${feature.id}`);
  }

  private syncFeatureFromUrl(url: string): void {
    const fragment = url.split('#')[1];
    const feature = this.features.find(candidate => `home-${candidate.id}` === fragment);
    this.selectedFeature.set(feature?.id ?? 'training');
    this.hasFeatureSelection.set(!!feature);
    this.featureScrollPending = !!feature;
    if (feature) this.scrollToFeature();
  }

  private scrollToFeature(): void {
    this.featureScrollPending = true;
  }

  private flushFeatureScroll(): void {
    if (!this.featureScrollPending) return;
    // Its deferred metrics change the hero height; position the feature after the shared overview renders.
    if (this.document.querySelector('.hero-preview .preview-placeholder--training')) return;
    this.featureScrollPending = false;
    this.cancelFeatureScrollFrame();
    const scroll = () => this.document.getElementById('home-feature-panel')
      ?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    scroll();
    // Give the shell a rendering frame after native scroll events, then align with its rendered header offset.
    this.featureScrollFrame = this.document.defaultView?.requestAnimationFrame(() => {
      this.featureScrollFrame = this.document.defaultView?.requestAnimationFrame(() => {
        this.featureScrollFrame = null;
        scroll();
      }) ?? null;
    }) ?? null;
  }

  private cancelFeatureScrollFrame(): void {
    if (this.featureScrollFrame === null) return;
    this.document.defaultView?.cancelAnimationFrame(this.featureScrollFrame);
    this.featureScrollFrame = null;
  }

  toggleFaq(id: string): void {
    if (!this.faqs.some(faq => faq.id === id)) return;
    this.expandedFaq.update(current => current === id ? null : id);
    this.haptics.selection();
  }
}
