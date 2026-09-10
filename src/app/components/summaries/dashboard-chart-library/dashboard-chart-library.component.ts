import { DOCUMENT } from '@angular/common';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatDialog } from '@angular/material/dialog';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { Observable, Subscription } from 'rxjs';
import { isDashboardKpiChartType } from '../../../helpers/dashboard-special-chart-types';
import { resolveDashboardChartInfoTooltip } from '../../../helpers/dashboard-chart-info.helper';
import { DASHBOARD_TILE_EVENT_RANGE_OPTIONS, normalizeDashboardTileEventFilters } from '../../../helpers/dashboard-tile-event-filters.helper';
import { Component, computed, inject, input, signal, ElementRef, effect, untracked, viewChild, TemplateRef, ViewContainerRef, DestroyRef, output } from '@angular/core';
import { AppUserInterface } from '../../../models/app-user.interface';
import { getAvailableDashboardCharts, getDashboardChartCatalog, matchesDashboardPreset } from '../../../helpers/dashboard-chart-catalog.helper';
import { DashboardTileLaneKey, getDashboardTileSectionDefinition, resolveDashboardTileLaneKey } from '../../../helpers/dashboard-tile-section.helper';
import { DashboardPreviewInput } from '../../../helpers/dashboard-chart-preview.helper';
import { DashboardChartLibraryState } from './dashboard-chart-library-state.service';
import { DashboardChartPreviewService } from '../../../services/dashboard-chart-preview.service';
@Component({ selector: 'app-dashboard-chart-library', standalone: false, templateUrl: './dashboard-chart-library.component.html', styleUrls: ['./dashboard-chart-library.component.css'], providers: [DashboardChartPreviewService] })
export class DashboardChartLibraryComponent {
  private readonly document = inject(DOCUMENT);
  private readonly dialog = inject(MatDialog);
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly picker = viewChild<TemplateRef<unknown>>('picker');
  private readonly entryButton = viewChild<ElementRef<HTMLButtonElement>>('entryButton');
  private readonly detail = viewChild<ElementRef<HTMLElement>>('detail');
  private readonly scrollContent = viewChild<ElementRef<HTMLElement>>('scrollContent');
  private readonly browser = viewChild<ElementRef<HTMLElement>>('browser');
  private overlay: { close: () => void; subscriptions: Subscription } | null = null;
  readonly pickerClosed = output<void>();
  readonly state = inject(DashboardChartLibraryState);
  readonly user = input.required<AppUserInterface>();
  readonly lane = input.required<DashboardTileLaneKey>();
  readonly seed = input<DashboardPreviewInput>({ tiles: [] });
  readonly darkTheme = input(false);
  readonly search = signal('');
  readonly group = signal('all');
  readonly page = signal(0);
  readonly sectionLabel = computed(() => this.lane() === 'kpi' ? 'KPIs' : getDashboardTileSectionDefinition(this.lane().slice(8) as never).label);
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
  constructor() {
    effect(() => {
      const expanded = this.expanded();
      const template = this.picker();
      untracked(() => {
        if (expanded && template && !this.overlay) this.openOverlay(template);
        if (!expanded) this.overlay?.close();
      });
    });
    this.destroyRef.onDestroy(() => {
      this.overlay?.subscriptions.unsubscribe();
      this.overlay?.close();
    });
  }

  private openOverlay(template: TemplateRef<unknown>): void {
    const returnFocus = this.document.activeElement as HTMLElement | null;
    const options = {
      viewContainerRef: this.viewContainerRef,
      disableClose: true, // Route every dismissal through the existing dirty-draft/pending-save guard.
      restoreFocus: false, // Restore here, then let the dashboard reveal a successfully saved tile.
      autoFocus: 'dialog',
      ariaLabel: `Chart library · ${this.sectionLabel()}`,
    };
    let close: () => void;
    let closed$: Observable<unknown>;
    let opened$: Observable<unknown>;
    let backdrop$: Observable<MouseEvent>;
    let keydown$: Observable<KeyboardEvent>;
    if (this.breakpoints.isMatched('(max-width: 959.98px)')) {
      const ref = this.bottomSheet.open(template, { ...options, height: '92dvh', maxHeight: '92dvh', panelClass: ['qs-bottom-sheet-container', 'qs-chart-picker-sheet'] });
      close = () => ref.dismiss(); closed$ = ref.afterDismissed(); opened$ = ref.afterOpened(); backdrop$ = ref.backdropClick(); keydown$ = ref.keydownEvents();
    } else {
      const ref = this.dialog.open(template, { ...options, width: '1180px', maxWidth: 'calc(100vw - 48px)', height: 'min(860px, 90dvh)', maxHeight: '90dvh' });
      close = () => ref.close(); closed$ = ref.afterClosed(); opened$ = ref.afterOpened(); backdrop$ = ref.backdropClick(); keydown$ = ref.keydownEvents();
    }
    const overlay = { close, subscriptions: new Subscription() };
    this.overlay = overlay;
    overlay.subscriptions.add(opened$.subscribe(() => this.state.draft() ? this.focusDetail() : this.focusBrowser()));
    overlay.subscriptions.add(backdrop$.subscribe(() => this.close()));
    overlay.subscriptions.add(keydown$.subscribe(event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); this.close();
    }));
    overlay.subscriptions.add(closed$.subscribe(() => {
      overlay.subscriptions.unsubscribe();
      if (this.overlay !== overlay) return;
      this.overlay = null;
      if (this.destroyRef.destroyed) return;
      if (this.expanded()) this.state.resetContext();
      const target = returnFocus?.isConnected && returnFocus !== this.document.body ? returnFocus : this.entryButton()?.nativeElement;
      target?.focus({ preventScroll: true });
      this.pickerClosed.emit();
    }));
  }

  async toggle(): Promise<void> {
    const wasExpanded = this.expanded();
    await this.state.open(this.lane());
    if (!wasExpanded && this.expanded() && this.lane() === 'section:custom' && !this.available().length) await this.createCustom();
  }
  async select(entry: ReturnType<typeof getAvailableDashboardCharts>[number]): Promise<void> {
    await this.state.select(this.user(), entry); this.focusDetail();
  }
  async createCustom(): Promise<void> { await this.state.createCustom(this.user()); this.focusDetail(); }
  async back(): Promise<void> { await this.state.back(); if (!this.state.draft()) this.focusBrowser(); }
  async close(): Promise<void> { await this.state.close(); }
  private focusDetail(): void { this.focusContent(() => this.detail()?.nativeElement); }
  private focusBrowser(): void { this.focusContent(() => this.browser()?.nativeElement); }
  private focusContent(target: () => HTMLElement | undefined): void {
    requestAnimationFrame(() => {
      const pane = target();
      pane?.focus({ preventScroll: true });
      if (pane) pane.scrollTop = 0;
      const content = this.scrollContent()?.nativeElement;
      if (content) content.scrollTop = 0;
    });
  }
  filter(value: string): void { this.search.set(value); this.page.set(0); }
  selectGroup(value: string): void { if (this.group() === value) return; this.state.haptics.selection(); this.group.set(value || 'all'); this.page.set(0); }
  changePage(delta: number): void { this.state.haptics.selection(); this.page.set(this.currentPage()+delta); this.focusBrowser(); }
}
