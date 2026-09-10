import { isDashboardKpiChartType } from '../../../helpers/dashboard-special-chart-types';
import { resolveDashboardChartInfoTooltip } from '../../../helpers/dashboard-chart-info.helper';
import { DASHBOARD_TILE_EVENT_RANGE_OPTIONS, normalizeDashboardTileEventFilters } from '../../../helpers/dashboard-tile-event-filters.helper';
import { Component, computed, inject, input, signal, ElementRef } from '@angular/core';
import { AppUserInterface } from '../../../models/app-user.interface';
import { getAvailableDashboardCharts, getDashboardChartCatalog, matchesDashboardPreset } from '../../../helpers/dashboard-chart-catalog.helper';
import { DashboardTileLaneKey, getDashboardTileSectionDefinition, resolveDashboardTileLaneKey } from '../../../helpers/dashboard-tile-section.helper';
import { DashboardPreviewInput } from '../../../helpers/dashboard-chart-preview.helper';
import { DashboardChartLibraryState } from './dashboard-chart-library-state.service';
import { DashboardChartPreviewService } from '../../../services/dashboard-chart-preview.service';
@Component({ selector: 'app-dashboard-chart-library', standalone: false, templateUrl: './dashboard-chart-library.component.html', styleUrls: ['./dashboard-chart-library.component.css'], providers: [DashboardChartPreviewService] })
export class DashboardChartLibraryComponent {
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  readonly state = inject(DashboardChartLibraryState);
  readonly user = input.required<AppUserInterface>();
  readonly lane = input.required<DashboardTileLaneKey>();
  readonly seed = input<DashboardPreviewInput>({ tiles: [] });
  readonly darkTheme = input(false);
  readonly search = signal('');
  readonly group = signal('all');
  readonly page = signal(0);
  readonly available = computed(() => getAvailableDashboardCharts(this.lane(), this.seed().tiles));
  readonly filtered = computed(() => this.available().filter(entry => `${entry.definition.label} ${entry.definition.description}`.toLowerCase().includes(this.search().toLowerCase()) && (this.group() === 'all' || entry.definition.category === 'kpi' && entry.definition.kpiGroup === this.group())));
  readonly visible = computed(() => this.filtered().slice(this.currentPage()*6, this.currentPage()*6+6));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length/6)));
  readonly currentPage = computed(() => Math.min(this.page(), this.totalPages()-1));
  private readonly catalog = getDashboardChartCatalog();
  readonly draftDefinition = computed(() => {
    const draft = this.state.draft();
    return draft ? this.catalog.find(entry => matchesDashboardPreset(draft, entry.tile))?.definition : null;
  });
  readonly explanation = computed(() => resolveDashboardChartInfoTooltip(this.state.draft()?.['chartType']) || this.draftDefinition()?.description || 'Choose a metric, chart style, aggregation and date range.');
  readonly dataScope = computed(() => {
    const tile = this.state.draft();
    if (!tile) return '';
    const type = `${tile['chartType'] || ''}`;
    if (type === 'SleepTrend') return 'Needs recorded sleep · Last 14 days';
    if (tile['mapSource'] === 'routes') return 'Needs saved routes · Up to 50 recent routes';
    if (isDashboardKpiChartType(type)) return 'Uses prepared training snapshots';
    const scopes: Record<string, string> = {
      Form: 'Training load history · Full history',
      RecoveryNowPie: 'Latest training recovery snapshot · Independent of activity filters',
      FreshnessForecast: 'Training load · Next 7 days with no new training',
      IntensityDistribution: 'Training intensity · Weekly distribution',
      EfficiencyTrend: 'Training efficiency · Recent weekly trend',
      PowerCurve: 'Activities with power · Last year',
      ActivityCalendar: 'Activity calendar · Current month',
    };
    if (scopes[type]) return scopes[type];
    const range = normalizeDashboardTileEventFilters(tile['eventFilters']).range;
    return 'Activity data · ' + (DASHBOARD_TILE_EVENT_RANGE_OPTIONS.find(option => option.range === range)?.label || range);
  });
  readonly expanded = computed(() => this.state.activeLane() === this.lane());
  readonly destination = computed(() => {
    const tile = this.state.draft(); if (!tile) return '';
    const lane = resolveDashboardTileLaneKey(tile);
    return lane === 'kpi' ? 'KPIs' : getDashboardTileSectionDefinition(lane.slice(8) as never).label;
  });
  async toggle(): Promise<void> {
    const wasExpanded = this.expanded();
    await this.state.open(this.lane());
    if (!wasExpanded && this.expanded() && this.lane() === 'section:custom' && !this.available().length) await this.createCustom();
  }
  async select(entry: ReturnType<typeof getAvailableDashboardCharts>[number]): Promise<void> {
    await this.state.select(this.user(), entry); this.focusDetail();
  }
  async createCustom(): Promise<void> { await this.state.createCustom(this.user()); this.focusDetail(); }
  async back(): Promise<void> { await this.state.back(); if (!this.state.draft()) requestAnimationFrame(() => this.element.nativeElement.querySelector<HTMLInputElement>('input')?.focus()); }
  async close(): Promise<void> { await this.state.close(); if (!this.expanded()) this.element.nativeElement.querySelector<HTMLButtonElement>('.chart-library-entry button')?.focus(); }
  private focusDetail(): void { requestAnimationFrame(() => this.element.nativeElement.querySelector<HTMLElement>('.chart-library-detail')?.focus()); }
  filter(value: string): void { this.search.set(value); this.page.set(0); }
  selectGroup(value: string): void { if (this.group() === value) return; this.state.haptics.selection(); this.group.set(value || 'all'); this.page.set(0); }
  changePage(delta: number): void { this.state.haptics.selection(); this.page.set(this.currentPage()+delta); }
}
