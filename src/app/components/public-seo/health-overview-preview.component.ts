import { ChangeDetectionStrategy, Component, ElementRef, afterEveryRender, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AppThemes, User, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { buildDashboardHealthExample } from '../../helpers/dashboard-health-preview.helper';
import { buildHealthMetricCatalogGroups, resolveHealthWorkspaceWindow, type HealthWorkspaceMetricSelection } from '../../helpers/health-workspace.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppThemeService } from '../../services/app.theme.service';
import { HealthCategoryOverviewComponent } from '../health/health-category-overview.component';
import { HealthMetricSeriesChartComponent } from '../health/health-metric-series-chart.component';
import { ChartsSleepTrendComponent } from '../charts/sleep-trend/charts.sleep-trend.component';

/** Static adapter for the actual Health overview and history renderers. No saved settings or measurements. */
@Component({
  selector: 'app-health-overview-preview', standalone: true,
  imports: [HealthCategoryOverviewComponent, HealthMetricSeriesChartComponent, ChartsSleepTrendComponent, MatButtonModule, MatIconModule],
  templateUrl: './health-overview-preview.component.html',
  styleUrls: ['./health-overview-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthOverviewPreviewComponent {
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  readonly groups = buildHealthMetricCatalogGroups();
  readonly referenceDate = '2026-08-31';
  readonly selectedMetric = signal<HealthWorkspaceMetricSelection | null>(null);
  private readonly haptics = inject(AppHapticsService);
  private readonly theme = inject(AppThemeService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private returnTarget: HTMLElement | null = null;
  private pendingFocus: 'history' | 'overview' | null = null;
  readonly darkTheme = computed(() => this.theme.appTheme() === AppThemes.Dark);
  readonly user = computed(() => Object.assign(new User('public-health-example'), {
    settings: { unitSettings: normalizeUserUnitSettings(this.unitSettings()) },
  }));
  readonly selectedLabel = computed(() => this.selectedMetric() === 'sleep' ? 'Sleep overview'
    : this.groups.flatMap(group => group.metrics).find(metric => metric.id === this.selectedMetric())?.label ?? '');
  readonly history = computed(() => {
    const metric = this.selectedMetric();
    if (!metric) return null;
    const settings = { metric, range: '30d' as const };
    return buildDashboardHealthExample(settings, resolveHealthWorkspaceWindow({ ...settings, endDate: this.referenceDate }), this.unitSettings());
  });

  constructor() {
    afterEveryRender(() => {
      if (!this.pendingFocus) return;
      const target = this.pendingFocus === 'history' ? this.host.nativeElement.querySelector<HTMLElement>('#health-sample-history-title')
        : this.returnTarget ?? this.host.nativeElement.querySelector<HTMLElement>('#health-overview-title');
      if (!target) return;
      const openingHistory = this.pendingFocus === 'history';
      this.pendingFocus = null;
      target.focus({ preventScroll: true });
      const scrollTarget = openingHistory ? this.host.nativeElement.querySelector<HTMLElement>('.sample-history') : target;
      scrollTarget?.scrollIntoView?.({ block: openingHistory ? 'start' : 'nearest', behavior: 'instant' });
    });
  }

  viewHistory(metric: HealthWorkspaceMetricSelection): void {
    if (metric === this.selectedMetric() || metric !== 'sleep' && !this.groups.some(group => group.metrics.some(item => item.id === metric))) return;
    this.selectedMetric.set(metric);
    const actionLabel = `View ${this.selectedLabel()} history`;
    // Pointer clicks can leave focus on another control. Resolve the metric action itself.
    this.returnTarget = Array.from(this.host.nativeElement.querySelectorAll<HTMLButtonElement>('app-health-category-overview mat-card-actions button'))
      .find(button => button.getAttribute('aria-label') === actionLabel) ?? null;
    this.pendingFocus = 'history';
    this.haptics.selection();
  }

  showOverview(): void {
    if (!this.selectedMetric()) return;
    this.selectedMetric.set(null);
    this.pendingFocus = 'overview';
    this.haptics.selection();
  }
}
