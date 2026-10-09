import { Component, OnInit, DestroyRef, ElementRef, PLATFORM_ID, afterEveryRender, inject, signal } from '@angular/core';
import { DOCUMENT, Location, isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MAT_TOOLTIP_DEFAULT_OPTIONS, MatTooltipModule } from '@angular/material/tooltip';
import { ASSISTANT_REQUEST_LIMITS, ROUTE_USAGE_LIMITS, USAGE_LIMITS } from '@shared/limits';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { getNumberFormatter } from '../../helpers/number-format.helper';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { PublicFeaturePreviewComponent } from '../public-seo/public-feature-preview.component';
import { HEALTH_FEATURE_CONTENT } from '../public-seo/health-feature.content';
import { TRAINING_PLANS_HOME_CONTENT } from '../public-seo/training-plans-home.content';
import { HomeRevealDirective } from './home-reveal.directive';

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

interface HomeScrollPosition {
  shell: [number, number] | null;
  viewport: [number, number];
}

interface HomeFeatureHistory {
  id: number;
  position?: HomeScrollPosition;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatIconModule, MatTooltipModule,
    PublicFeaturePreviewComponent, CompactRowComponent, HomeRevealDirective],
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private featureScrollFrame: number | null = null;
  private featureScrollTarget: string | HomeScrollPosition | null = null;
  private readonly featureHistoryPositions = new Map<number, HomeScrollPosition>();
  private currentHistoryEntry: number | null = null;
  private nextHistoryEntry = 0;
  private currentFeatureFragment = '';
  private readonly featureScroll = afterEveryRender(() => this.flushFeatureScroll());
  readonly features = HOME_FEATURES;
  readonly expandedFaq = signal<string | null>(null);
  readonly healthFeature = HEALTH_FEATURE_CONTENT;
  readonly trainingPlansFeature = TRAINING_PLANS_HOME_CONTENT;
  readonly memberships = [
    { name: 'Starter', label: 'Free', copy: 'A place to begin.', route: '/login', action: 'Start free',
      features: [`Up to ${getNumberFormatter().format(USAGE_LIMITS.free)} activities`,
        `Up to ${getNumberFormatter().format(ROUTE_USAGE_LIMITS.free)} saved routes`, 'Plans and standalone workouts',
        `Up to ${getNumberFormatter().format(ASSISTANT_REQUEST_LIMITS.free)} Assistant requests per calendar month`] },
    { name: 'Basic', label: 'More history', copy: 'For consistent training.', route: '/pricing', action: 'Explore Basic',
      features: [`Up to ${getNumberFormatter().format(USAGE_LIMITS.basic)} activities`,
        `Up to ${getNumberFormatter().format(ROUTE_USAGE_LIMITS.basic)} saved routes`,
        `Up to ${getNumberFormatter().format(ASSISTANT_REQUEST_LIMITS.basic)} Assistant requests per billing period`] },
    { name: 'Pro', label: 'Keep it connected', copy: 'For your complete workflow.', route: '/pricing', action: 'Explore Pro',
      features: ['Unlimited activities and routes', 'Supported cross-provider sync', 'Compatible workout delivery',
        `Up to ${getNumberFormatter().format(ASSISTANT_REQUEST_LIMITS.pro)} Assistant requests per billing period`] },
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
    this.syncFeatureAnchorFromUrl(this.location.path(true), this.location.getState());
    this.destroyRef.onDestroy(this.location.onUrlChange((url, state) => this.syncFeatureAnchorFromUrl(url, state)));
    this.destroyRef.onDestroy(() => this.cancelFeatureScrollFrame());
    this.authService.user$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(user => {
      if (user) void this.router.navigate(['/dashboard']);
    });
  }

  jumpToFeature(id: string, event?: MouseEvent): void {
    // Let modified links open their shareable feature URL in another tab.
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0)) return;
    event?.preventDefault();
    const feature = this.features.find(candidate => candidate.id === id);
    if (!feature) return;
    const fragment = `home-${feature.id}`;
    if (fragment === this.currentFeatureFragment) {
      this.featureScrollTarget = fragment;
      return;
    }
    this.haptics.selection();
    const currentUrl = this.location.path(true);
    const state = this.location.getState();
    const historyState = state && typeof state === 'object' ? state : {};
    const entry: HomeFeatureHistory = {
      id: this.currentHistoryEntry ?? this.nextHistoryEntry++,
      position: this.readScrollPosition(),
    };
    // Preserve the exact outgoing view, including entries without a section fragment.
    this.location.replaceState(currentUrl, '', { ...historyState, qsHomeFeature: entry });
    const path = currentUrl.split('#')[0];
    this.location.go(`${path}#${fragment}`, '', { qsHomeFeature: { id: this.nextHistoryEntry++ } });
  }

  private syncFeatureAnchorFromUrl(url: string, state: unknown): void {
    const entry = (state as { qsHomeFeature?: HomeFeatureHistory } | null)?.qsHomeFeature;
    const entryId = entry && Number.isSafeInteger(entry.id) && entry.id >= 0 ? entry.id : null;
    if (this.currentHistoryEntry !== null && this.currentHistoryEntry !== entryId) {
      // Popstate runs before our scroll: cache the view being left for Forward/Back.
      this.featureHistoryPositions.set(this.currentHistoryEntry, this.readScrollPosition());
    }
    this.cancelFeatureScrollFrame();
    this.currentHistoryEntry = entryId;
    if (entryId !== null) this.nextHistoryEntry = Math.max(this.nextHistoryEntry, entryId + 1);
    this.currentFeatureFragment = url.split('#')[1] ?? '';
    const savedPosition = entryId === null ? null
      : this.featureHistoryPositions.get(entryId) ?? entry?.position;
    if (this.isScrollPosition(savedPosition)) {
      this.featureScrollTarget = savedPosition;
      return;
    }
    this.featureScrollTarget = this.features.some(feature => `home-${feature.id}` === this.currentFeatureFragment)
      ? this.currentFeatureFragment : null;
  }

  private flushFeatureScroll(): void {
    if (!this.featureScrollTarget) return;
    const destination = this.featureScrollTarget;
    const target = typeof destination === 'string' ? this.document.getElementById(destination) : null;
    if (typeof destination === 'string' && !target) return;
    this.featureScrollTarget = null;
    this.cancelFeatureScrollFrame();
    const scroll = () => {
      if (target) {
        target.scrollIntoView?.({ block: 'start', behavior: 'instant' });
        return;
      }
      if (typeof destination === 'string') return;
      const shell = this.host.nativeElement.closest<HTMLElement>('mat-sidenav-content');
      if (shell && destination.shell) {
        [shell.scrollLeft, shell.scrollTop] = destination.shell;
      }
      this.document.defaultView?.scrollTo({
        left: destination.viewport[0], top: destination.viewport[1], behavior: 'instant',
      });
    };
    scroll();
    // Align again once the shell has rendered its visible header offset after scrolling.
    this.featureScrollFrame = this.document.defaultView?.requestAnimationFrame(() => {
      this.featureScrollFrame = this.document.defaultView?.requestAnimationFrame(() => {
        this.featureScrollFrame = null;
        scroll();
      }) ?? null;
    }) ?? null;
  }

  private readScrollPosition(): HomeScrollPosition {
    const shell = this.host.nativeElement.closest<HTMLElement>('mat-sidenav-content');
    const viewport = this.document.defaultView;
    return {
      shell: shell ? [shell.scrollLeft, shell.scrollTop] : null,
      viewport: [viewport?.scrollX ?? 0, viewport?.scrollY ?? 0],
    };
  }

  private isScrollPosition(position: unknown): position is HomeScrollPosition {
    if (!position || typeof position !== 'object') return false;
    const { shell, viewport } = position as Partial<HomeScrollPosition>;
    const isPair = (value: unknown) => Array.isArray(value) && value.length === 2
      && value.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate) && coordinate >= 0);
    return isPair(viewport) && (shell === null || isPair(shell));
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
