import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import type { HealthProvider } from '@shared/health';
import type { AppDashboardHealthMetricSettings, AppUserInterface } from '../../models/app-user.interface';
import {
  buildHealthOverviewCategories, selectHealthOverviewMetrics,
  type HealthMetricCatalogGroup, type HealthOverviewCategoryId, type HealthWorkspaceMetricSelection,
} from '../../helpers/health-workspace.helper';
import { healthMetricIcon } from '../../helpers/health-metric-icon.helper';
import type { TimelineNoteChartContext } from '../../helpers/timeline-notes-chart.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { DashboardHealthChartComponent } from '../charts/health/dashboard-health-chart.component';
import type { DashboardHealthContext } from '../../helpers/dashboard-health-context.helper';

@Component({
  selector: 'app-health-category-overview',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatChipsModule, MatIconModule, DashboardHealthChartComponent],
  templateUrl: './health-category-overview.component.html',
  styleUrls: ['./health-category-overview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthCategoryOverviewComponent {
  readonly user = input.required<AppUserInterface>();
  readonly groups = input.required<readonly HealthMetricCatalogGroup[]>();
  readonly showSleep = input(false);
  readonly darkTheme = input(false);
  readonly referenceDate = input<string | null>(null);
  readonly providerFilter = input<readonly HealthProvider[]>([]);
  readonly timelineNotes = input<TimelineNoteChartContext | null>(null);
  readonly metricSelected = output<HealthWorkspaceMetricSelection>();
  readonly providersObserved = output<{ uid: string; providers: HealthProvider[] }>();
  private readonly owner = computed(() => this.user().uid);
  private readonly haptics = inject(AppHapticsService);
  private readonly category = signal<HealthOverviewCategoryId | 'all'>('all');
  private readonly sourceSettings = signal<Partial<Record<HealthWorkspaceMetricSelection, AppDashboardHealthMetricSettings>>>({});
  readonly categories = computed(() => buildHealthOverviewCategories(this.groups(), this.showSleep()));
  readonly selectedCategory = computed(() => this.categories().some(category => category.id === this.category()) ? this.category() : 'all');
  readonly cards = computed(() => {
    const categories = this.categories();
    const metrics = this.selectedCategory() === 'all' ? selectHealthOverviewMetrics(categories)
      : categories.find(category => category.id === this.selectedCategory())!.metrics;
    const settings = this.sourceSettings();
    return metrics.map(metric => ({ ...metric, icon: healthMetricIcon(metric.id),
      settings: settings[metric.id] || { metric: metric.id, range: '30d' as const },
    }));
  });

  constructor() {
    // Source and category choices belong only to this open account workspace.
    effect(() => {
      this.owner();
      this.sourceSettings.set({});
      this.category.set('all');
    });
  }

  selectCategory(category: HealthOverviewCategoryId | 'all'): void {
    if (category === this.selectedCategory() || category !== 'all' && !this.categories().some(item => item.id === category)) return;
    this.haptics.selection();
    this.category.set(category);
  }

  updateCardSettings(settings: AppDashboardHealthMetricSettings): void {
    if (settings.range !== '30d' || !this.cards().some(card => card.id === settings.metric)) return;
    this.sourceSettings.update(current => ({ ...current, [settings.metric]: settings }));
  }

  observeSources(context: DashboardHealthContext): void {
    this.providersObserved.emit({ uid: this.owner(), providers: [...new Set(context.sources.map(source => source.provider))] });
  }
}
