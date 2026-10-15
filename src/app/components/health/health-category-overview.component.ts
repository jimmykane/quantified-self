import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { HealthProvider } from '@shared/health';
import type { AppDashboardHealthMetricSettings, AppHealthMetricSources, AppUserInterface } from '../../models/app-user.interface';
import {
  buildHealthOverviewCategories, selectHealthOverviewMetrics, opaqueHealthSeriesId,
  type HealthMetricCatalogGroup, type HealthOverviewCategoryId, type HealthWorkspaceMetricSelection,
} from '../../helpers/health-workspace.helper';
import { healthMetricIcon } from '../../helpers/health-metric-icon.helper';
import type { TimelineNoteChartContext } from '../../helpers/timeline-notes-chart.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { DashboardHealthChartComponent } from '../charts/health/dashboard-health-chart.component';
import type { DashboardHealthContext } from '../../helpers/dashboard-health-context.helper';
import type { HealthChangeSignal } from '../../helpers/health-change-summary.helper';
import { HealthChangeSummaryComponent } from '../shared/health-change-summary/health-change-summary.component';
import { normalizeHealthMetricSources } from '../../helpers/health-highlight-preferences.helper';

export interface HealthMetricSourceSelection {
  uid: string;
  metric: HealthWorkspaceMetricSelection;
  sourceKey: string;
}

@Component({
  selector: 'app-health-category-overview',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatChipsModule, MatIconModule, MatProgressSpinnerModule, DashboardHealthChartComponent, HealthChangeSummaryComponent],
  templateUrl: './health-category-overview.component.html',
  styleUrls: ['./health-category-overview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthCategoryOverviewComponent {
  readonly user = input.required<AppUserInterface>();
  readonly groups = input.required<readonly HealthMetricCatalogGroup[]>();
  readonly showSleep = input(false);
  readonly highlightedMetrics = input<readonly HealthWorkspaceMetricSelection[]>([]);
  readonly vitalsHighlightedMetrics = input<readonly HealthWorkspaceMetricSelection[]>([]);
  readonly exampleOnly = input(false);
  readonly darkTheme = input(false);
  readonly referenceDate = input<string | null>(null);
  readonly providerFilter = input<readonly HealthProvider[]>([]);
  readonly timelineNotes = input<TimelineNoteChartContext | null>(null);
  readonly changeSignals = input<readonly HealthChangeSignal[]>([]);
  readonly preferredSources = input<AppHealthMetricSources | null>(null);
  readonly savingPreferences = input(false);
  readonly metricSelected = output<HealthWorkspaceMetricSelection>();
  readonly providersObserved = output<{ uid: string; providers: HealthProvider[] }>();
  readonly sourceSelected = output<HealthMetricSourceSelection>();
  private readonly owner = computed(() => this.user().uid);
  private readonly haptics = inject(AppHapticsService);
  private readonly category = signal<HealthOverviewCategoryId | 'all'>('all');
  private readonly sourceSettings = signal<Partial<Record<HealthWorkspaceMetricSelection, AppDashboardHealthMetricSettings>>>({});
  private readonly observedAvailability = signal<Partial<Record<HealthWorkspaceMetricSelection, { scope: string; empty: boolean }>>>({});
  private readonly availabilityScope = computed(() => JSON.stringify([
    this.owner(), this.referenceDate(), [...this.providerFilter()].sort(),
  ]));
  readonly categories = computed(() => buildHealthOverviewCategories(this.groups(), this.showSleep()));
  readonly selectedCategory = computed(() => this.categories().some(category => category.id === this.category()) ? this.category() : 'all');
  readonly hasOverviewHighlights = computed(() => this.selectedCategory() === 'all' && this.highlightedMetrics().length > 0);
  readonly hasVitalsHighlights = computed(() => this.selectedCategory() === 'vitals' && this.vitalsHighlightedMetrics().length > 0);
  readonly cards = computed(() => {
    const categories = this.categories();
    // Each visible highlight owns its metric's presentation and history action.
    // Other categories retain their full catalog, including historical readings.
    const highlighted = new Set(this.highlightedMetrics());
    const metrics = this.selectedCategory() === 'all' ? selectHealthOverviewMetrics(categories.map(category => ({
      ...category, metrics: category.metrics.filter(metric => !highlighted.has(metric.id)),
    })))
      : categories.find(category => category.id === this.selectedCategory())!.metrics
        .filter(metric => !this.hasVitalsHighlights() || !this.vitalsHighlightedMetrics().includes(metric.id));
    const settings = this.sourceSettings();
    const preferred = normalizeHealthMetricSources(this.preferredSources() ?? this.user().settings?.appSettings?.healthWorkspace?.metricSources);
    const availability = this.observedAvailability();
    const scope = this.availabilityScope();
    return metrics.map(metric => ({ ...metric, icon: healthMetricIcon(metric.id),
      settings: settings[metric.id] || { metric: metric.id, range: '30d' as const,
        ...(preferred[metric.id] ? { sourceKey: preferred[metric.id] } : {}) },
      hidden: this.selectedCategory() === 'all' && !this.exampleOnly()
        && !settings[metric.id]?.sourceKey && !preferred[metric.id]
        && availability[metric.id]?.scope === scope && availability[metric.id].empty,
    }));
  });
  readonly hasVisibleCards = computed(() => this.cards().some(card => !card.hidden));

  constructor() {
    // Optimistic choices and category browsing cannot cross account boundaries.
    effect(() => {
      this.owner();
      this.sourceSettings.set({});
      this.observedAvailability.set({});
      this.category.set('all');
    });
  }

  selectCategory(category: HealthOverviewCategoryId | 'all'): void {
    if (category === this.selectedCategory() || category !== 'all' && !this.categories().some(item => item.id === category)) return;
    this.haptics.selection();
    this.category.set(category);
  }

  updateCardSettings(settings: AppDashboardHealthMetricSettings, initial = false): void {
    if (settings.range !== '30d' || !this.cards().some(card => card.id === settings.metric)) return;
    const previous = this.cards().find(card => card.id === settings.metric)?.settings.sourceKey;
    this.sourceSettings.update(current => ({ ...current, [settings.metric]: settings }));
    if (initial || this.exampleOnly() || !settings.sourceKey || settings.sourceKey === previous) return;
    const sourceKey = settings.metric === 'sleep' ? opaqueHealthSeriesId(settings.sourceKey) : settings.sourceKey;
    if (normalizeHealthMetricSources({ [settings.metric]: sourceKey })[settings.metric] === sourceKey) {
      this.sourceSelected.emit({ uid: this.owner(), metric: settings.metric, sourceKey });
    }
  }

  observeReadFailure(metric: HealthWorkspaceMetricSelection): void {
    this.observedAvailability.update(current => ({ ...current, [metric]: {
      scope: this.availabilityScope(), empty: false,
    } }));
  }

  observeSources(context: DashboardHealthContext): void {
    this.providersObserved.emit({ uid: this.owner(), providers: [...new Set(context.sources.map(source => source.provider))] });
    if (context.window.range !== '30d' || this.referenceDate() && context.window.endDate !== this.referenceDate()) return;
    // Keep readers mounted so a refresh can reveal new data. Category browsing,
    // failed/partial loads and a missing chosen source retain their existing states.
    this.observedAvailability.update(current => ({ ...current, [context.window.metric]: {
      scope: this.availabilityScope(),
      empty: context.availability.state === 'no-data' && context.sources.length === 0
        && !context.missingSource && !context.sampleOnly,
    } }));
  }
}
