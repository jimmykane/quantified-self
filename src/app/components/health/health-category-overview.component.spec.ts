import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { HealthCategoryOverviewComponent } from './health-category-overview.component';
import { DashboardHealthChartComponent } from '../charts/health/dashboard-health-chart.component';
import { AppHapticsService } from '../../services/app.haptics.service';
import { buildHealthMetricCatalogGroups, resolveHealthWorkspaceWindow, type HealthWorkspaceMetricSelection } from '../../helpers/health-workspace.helper';
import type { AppDashboardHealthMetricSettings } from '../../models/app-user.interface';
import { buildDashboardHealthContext, type DashboardHealthContext, type DashboardHealthEvidence } from '../../helpers/dashboard-health-context.helper';
import { DashboardHealthService } from '../../services/dashboard-health.service';
import { Subject } from 'rxjs';
import { buildDashboardHealthExample } from '../../helpers/dashboard-health-preview.helper';
import { opaqueHealthSeriesId } from '../../helpers/health-workspace.helper';

@Component({ selector: 'app-dashboard-health-chart', standalone: true, template: '' })
class HealthChartStubComponent {
  readonly user = input.required();
  readonly settings = input.required<AppDashboardHealthMetricSettings>();
  readonly overview = input(false);
  readonly exampleOnly = input(false);
  readonly hideTitle = input(false);
  readonly darkTheme = input(false);
  readonly referenceDate = input(null);
  readonly providerFilter = input([]);
  readonly timelineNotes = input(null);
  readonly settingsChange = output<{ settings: AppDashboardHealthMetricSettings; initial: boolean }>();
  readonly contextChange = output<DashboardHealthContext>();
  readonly readFailed = output<void>();
}

describe('Health category overview', () => {
  const haptics = { selection: vi.fn() };
  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({ imports: [HealthCategoryOverviewComponent, NoopAnimationsModule], providers: [
      { provide: AppHapticsService, useValue: haptics },
    ] }).overrideComponent(HealthCategoryOverviewComponent, {
      remove: { imports: [DashboardHealthChartComponent] }, add: { imports: [HealthChartStubComponent] },
    }).compileComponents();
  });
  function create() {
    const fixture = TestBed.createComponent(HealthCategoryOverviewComponent);
    fixture.componentRef.setInput('user', { uid: 'owner', settings: { unitSettings: {} } });
    fixture.componentRef.setInput('groups', buildHealthMetricCatalogGroups());
    fixture.componentRef.setInput('showSleep', true);
    fixture.detectChanges();
    return fixture;
  }
  function emptyContext(metric: HealthWorkspaceMetricSelection, endDate = '2026-10-11'): DashboardHealthContext {
    const settings = { metric, range: '30d' as const };
    return buildDashboardHealthContext({
      window: resolveHealthWorkspaceWindow({ ...settings, endDate }),
      health: null, history: null, activities: null, sessions: [], errors: [],
    }, settings);
  }
  it('names the actual HR measurement and hands the default reading to history without requiring a source change', () => {
    const fixture = create(), component = fixture.componentInstance;
    component.selectCategory('vitals'); fixture.detectChanges();
    const context = buildDashboardHealthExample({ metric: 'heart_rate', range: '30d' },
      resolveHealthWorkspaceWindow({ metric: 'heart_rate', range: '30d', endDate: '2026-10-11' }), null);
    context.selectedKey = opaqueHealthSeriesId('selected-daytime');
    context.selected!.model.series.semanticVariant = 'activity_interval_average';
    component.observeSources(context); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#health-overview-heart_rate')?.textContent).toContain('Heart rate');
    const opened = vi.fn(), selected = vi.fn();
    component.readingOpened.subscribe(opened); component.metricSelected.subscribe(selected);
    fixture.nativeElement.querySelector('[aria-label="View Heart rate history"]').click();
    expect(opened).toHaveBeenCalledExactlyOnceWith({ uid: 'owner', metric: 'heart_rate', sourceKey: context.selectedKey });
    expect(selected).toHaveBeenCalledExactlyOnceWith('heart_rate');
    fixture.componentRef.setInput('user', { uid: 'other-owner', settings: { unitSettings: {} } }); fixture.detectChanges();
    component.openHistory('heart_rate'); expect(opened).toHaveBeenCalledTimes(1);
  });
  it('puts the change summary above existing metrics only on All and leaves cards intact', () => {
    const fixture = create();
    fixture.componentRef.setInput('changeSignals', [{ id: 'hrv', label: 'HRV', sourceLabel: 'Suunto',
      state: 'insufficient', statusText: 'Building personal range', detailText: '6/14 nights' }]);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const summary = host.querySelector('app-health-change-summary')!;
    const originalCards = fixture.componentInstance.cards().map(card => card.id);
    expect(summary.textContent).toContain('More readings are needed to find your usual range.');
    expect(summary.compareDocumentPosition(host.querySelector('.health-overview-grid')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    summary.querySelector('button')!.click(); fixture.detectChanges();
    expect(summary.textContent).toContain('6/14 nights');
    expect(fixture.componentInstance.cards().map(card => card.id)).toEqual(originalCards);
    fixture.componentInstance.selectCategory('vitals'); fixture.detectChanges();
    expect(host.querySelector('app-health-change-summary')).toBeNull();
    expect(fixture.componentInstance.cards().length).toBeGreaterThan(0);
    fixture.componentInstance.selectCategory('all'); fixture.detectChanges();
    expect(host.querySelector('app-health-change-summary button')!.getAttribute('aria-expanded')).toBe('false');
  });
  it('omits confirmed empty default readings while retaining their readers and category history', () => {
    const fixture = create(), component = fixture.componentInstance;
    fixture.componentRef.setInput('groups', buildHealthMetricCatalogGroups(['body_weight', 'vo2_max']));
    fixture.componentRef.setInput('showSleep', false); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const weight = host.querySelector<HTMLElement>('[aria-labelledby="health-overview-body_weight"]')!;
    const chart = fixture.debugElement.queryAll(By.directive(HealthChartStubComponent))
      .find(item => item.componentInstance.settings().metric === 'body_weight')!.componentInstance as HealthChartStubComponent;
    for (const item of fixture.debugElement.queryAll(By.directive(HealthChartStubComponent))) {
      item.componentInstance.contextChange.emit(emptyContext(item.componentInstance.settings().metric));
    }
    fixture.detectChanges();
    expect(weight.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('[aria-labelledby="health-overview-vo2_max"]')!.hidden).toBe(true);
    expect(host.textContent).toContain('Choose a category to explore your recorded Health metrics');
    expect(fixture.debugElement.queryAll(By.directive(HealthChartStubComponent))).toHaveLength(2);
    component.selectCategory('body'); fixture.detectChanges();
    expect(host.querySelector('[aria-labelledby="health-overview-body_weight"]')).toBe(weight);
    expect(weight.hidden).toBe(false);
    component.selectCategory('all'); fixture.detectChanges();
    expect(weight.hidden).toBe(true);
    chart.readFailed.emit(); fixture.detectChanges();
    expect(weight.hidden).toBe(false);
    expect(host.querySelector('.health-overview-empty')).toBeNull();
    chart.contextChange.emit(emptyContext('body_weight')); fixture.detectChanges();
    expect(weight.hidden).toBe(true);
    const empty = emptyContext('body_weight');
    chart.contextChange.emit({ ...empty, hasData: true, availability: { ...empty.availability, state: 'ready', hasData: true } });
    fixture.detectChanges();
    expect(host.querySelector('[aria-labelledby="health-overview-body_weight"]')).toBe(weight);
    expect(weight.hidden).toBe(false);
    expect(host.querySelector('.health-overview-empty')).toBeNull();
  });
  it('retains missing-source, incomplete and failed default cards and scopes empty results to the inspected account and filters', () => {
    const fixture = create();
    fixture.componentRef.setInput('referenceDate', '2026-10-11'); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const weight = host.querySelector<HTMLElement>('[aria-labelledby="health-overview-body_weight"]')!;
    const chart = fixture.debugElement.queryAll(By.directive(HealthChartStubComponent))
      .find(item => item.componentInstance.settings().metric === 'body_weight')!.componentInstance as HealthChartStubComponent;
    const empty = emptyContext('body_weight');
    for (const context of [
      { ...empty, missingSource: true },
      { ...empty, sampleOnly: true },
      { ...empty, availability: { ...empty.availability, state: 'error' as const } },
    ]) {
      chart.contextChange.emit(context); fixture.detectChanges();
      expect(weight.hidden).toBe(false);
    }
    chart.contextChange.emit(empty); fixture.detectChanges(); expect(weight.hidden).toBe(true);
    fixture.componentRef.setInput('providerFilter', ['GarminAPI']); fixture.detectChanges(); expect(weight.hidden).toBe(false);
    chart.contextChange.emit(empty); fixture.detectChanges(); expect(weight.hidden).toBe(true);
    fixture.componentRef.setInput('referenceDate', '2026-10-10'); fixture.detectChanges(); expect(weight.hidden).toBe(false);
    chart.contextChange.emit(empty); fixture.detectChanges(); expect(weight.hidden).toBe(false);
    chart.contextChange.emit(emptyContext('body_weight', '2026-10-10')); fixture.detectChanges(); expect(weight.hidden).toBe(true);
    fixture.componentRef.setInput('user', { uid: 'other-owner', settings: { unitSettings: {} } }); fixture.detectChanges();
    expect(weight.hidden).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('opens with six real catalog cards and forwards shared chart inputs without example data', () => {
    const fixture = create(), component = fixture.componentInstance;
    expect(component.cards().map(card => card.id)).toEqual(['sleep', 'heart_rate_variability', 'resting_heart_rate', 'vo2_max', 'body_weight', 'steps']);
    const chart = fixture.debugElement.query(By.directive(HealthChartStubComponent)).componentInstance as HealthChartStubComponent;
    expect(chart.overview()).toBe(true);
    expect(chart.exampleOnly()).toBe(false);
    expect(chart.settings()).toEqual({ metric: 'sleep', range: '30d' });
    fixture.componentRef.setInput('providerFilter', ['GarminAPI']); fixture.componentRef.setInput('darkTheme', true); fixture.detectChanges();
    expect(chart.providerFilter()).toEqual(['GarminAPI']); expect(chart.darkTheme()).toBe(true);
    fixture.componentRef.setInput('referenceDate', '2026-10-10'); fixture.detectChanges();
    expect(chart.referenceDate()).toBe('2026-10-10');
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('uses the same cards in explicit public example mode and labels their readings as fictional', () => {
    const fixture = create();
    fixture.componentRef.setInput('exampleOnly', true); fixture.detectChanges();
    const charts = fixture.debugElement.queryAll(By.directive(HealthChartStubComponent));
    expect(charts).toHaveLength(6);
    expect(charts.every(chart => chart.componentInstance.exampleOnly())).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Fictional sample readings');
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('deduplicates only highlighted metrics on All and preserves every category metric', () => {
    const fixture = create(), component = fixture.componentInstance;
    fixture.componentRef.setInput('highlightedMetrics', ['sleep', 'heart_rate_variability', 'heart_rate']);
    fixture.detectChanges();
    expect(component.cards().map(card => card.id)).toEqual(['resting_heart_rate', 'vo2_max', 'body_weight', 'steps']);
    expect(component.cards().some(card => ['sleep', 'heart_rate_variability', 'heart_rate'].includes(card.id))).toBe(false);
    expect(component.cards().map(card => card.id)).toContain('resting_heart_rate');
    const highlights = fixture.nativeElement.querySelector('.health-overview-highlights') as HTMLElement;
    expect(highlights.hidden).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled();
    component.selectCategory('recovery'); fixture.detectChanges();
    expect(highlights.hidden).toBe(true);
    expect(component.cards().map(card => card.id)).toContain('sleep');
    component.selectCategory('vitals'); fixture.detectChanges();
    expect(component.cards().map(card => card.id)).toEqual(expect.arrayContaining(['heart_rate_variability', 'heart_rate']));
    component.selectCategory('all'); fixture.detectChanges();
    expect(highlights.hidden).toBe(false);
    fixture.componentRef.setInput('highlightedMetrics', []); fixture.detectChanges();
    expect(highlights.hidden).toBe(true);
    expect(component.cards().map(card => card.id)).toEqual(expect.arrayContaining(['sleep', 'heart_rate_variability']));
  });
  it('does not claim there are no readings when highlights cover every overview metric', () => {
    const fixture = create();
    fixture.componentRef.setInput('groups', []);
    fixture.componentRef.setInput('highlightedMetrics', ['sleep']);
    fixture.detectChanges();
    expect(fixture.componentInstance.cards()).toEqual([]);
    expect(fixture.nativeElement.textContent).not.toContain('No recorded Health metrics yet');
    expect(fixture.nativeElement.textContent).toContain('Recovery & sleep');
    fixture.componentInstance.selectCategory('recovery'); fixture.detectChanges();
    expect(fixture.componentInstance.cards().map(card => card.id)).toEqual(['sleep']);
  });
  it('omits intensity durations on All after highlight deduplication but opens their category history', () => {
    const fixture = create(), component = fixture.componentInstance, selected = vi.fn();
    fixture.componentRef.setInput('groups', buildHealthMetricCatalogGroups([
      'steps', 'moderate_intensity_duration', 'vigorous_intensity_duration',
    ]));
    fixture.componentRef.setInput('highlightedMetrics', ['sleep', 'heart_rate_variability', 'heart_rate']);
    fixture.detectChanges();
    expect(component.cards().map(card => card.id)).toEqual(['steps']);
    component.selectCategory('movement'); fixture.detectChanges();
    expect(component.cards().map(card => card.id)).toEqual(expect.arrayContaining([
      'steps', 'moderate_intensity_duration', 'vigorous_intensity_duration',
    ]));
    component.metricSelected.subscribe(selected);
    fixture.nativeElement.querySelector('button[aria-label="View Moderate intensity duration history"]').click();
    expect(selected).toHaveBeenCalledExactlyOnceWith('moderate_intensity_duration');
    component.selectCategory('all'); fixture.detectChanges();
    expect(component.cards().map(card => card.id)).toEqual(['steps']);
  });
  it('offers category browsing when only intensity durations are recorded', () => {
    const fixture = create(), component = fixture.componentInstance;
    fixture.componentRef.setInput('groups', buildHealthMetricCatalogGroups([
      'moderate_intensity_duration', 'vigorous_intensity_duration',
    ]));
    fixture.componentRef.setInput('showSleep', false); fixture.detectChanges();
    expect(component.cards()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('Choose a category to explore your recorded Health metrics');
    expect(fixture.nativeElement.textContent).not.toContain('No recorded Health metrics yet');
    component.selectCategory('movement'); fixture.detectChanges();
    expect(component.cards().map(card => card.id)).toEqual(['moderate_intensity_duration', 'vigorous_intensity_duration']);
  });
  it('shows today’s heart rate only in Vitals without repeating its metric card', () => {
    const fixture = create(), component = fixture.componentInstance;
    fixture.componentRef.setInput('highlightedMetrics', ['sleep', 'heart_rate_variability']);
    fixture.componentRef.setInput('vitalsHighlightedMetrics', ['heart_rate']); fixture.detectChanges();
    const vitals = fixture.nativeElement.querySelector('.health-vitals-highlights') as HTMLElement;
    expect(vitals.hidden).toBe(true);
    component.selectCategory('vitals'); fixture.detectChanges();
    expect(vitals.hidden).toBe(false);
    expect(fixture.nativeElement.querySelector('.health-overview-heading p').textContent).not.toContain('Last 30 days');
    expect(component.cards().map(card => card.id)).not.toContain('heart_rate');
    expect(component.cards().map(card => card.id)).toContain('heart_rate_variability');
    fixture.componentRef.setInput('vitalsHighlightedMetrics', []); fixture.detectChanges();
    expect(vitals.hidden).toBe(true);
    expect(component.cards().map(card => card.id)).toContain('heart_rate');
    component.selectCategory('all'); fixture.detectChanges();
    expect(component.cards().map(card => card.id)).toEqual(['resting_heart_rate', 'vo2_max', 'body_weight', 'steps']);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });
  it('filters by category using Material semantic selection and keeps unchanged actions silent', () => {
    const fixture = create(), component = fixture.componentInstance;
    const chips = fixture.nativeElement.querySelectorAll('mat-chip-option button');
    chips[1].click(); fixture.detectChanges();
    expect(component.selectedCategory()).toBe('body');
    expect(component.cards().map(card => card.id)).toContain('body_weight');
    expect(component.cards().map(card => card.id)).not.toContain('vo2_max');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    component.selectCategory('body'); component.selectCategory('unknown' as never);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    component.selectCategory('fitness'); fixture.detectChanges();
    expect(component.cards().map(card => card.id)).toEqual(['fitness_age', 'vo2_max']);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });
  it('reports discovered card sources to the owner-scoped workspace inventory without feedback', () => {
    const fixture = create(), reported = vi.fn();
    fixture.componentInstance.providersObserved.subscribe(reported);
    const chart = fixture.debugElement.query(By.directive(HealthChartStubComponent)).componentInstance as HealthChartStubComponent;
    chart.contextChange.emit({ ...emptyContext('sleep'), sources: [{ provider: 'QuantifiedSelf' }, { provider: 'GarminAPI' }, { provider: 'GarminAPI' }] } as DashboardHealthContext);
    expect(reported).toHaveBeenCalledExactlyOnceWith({ uid: 'owner', providers: ['QuantifiedSelf', 'GarminAPI'] });
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('keeps source choices across category changes and clears them when the account changes', () => {
    const fixture = create(), component = fixture.componentInstance;
    component.updateCardSettings({ metric: 'body_weight', range: '30d', sourceKey: 'manual-source' });
    component.selectCategory('fitness'); component.selectCategory('all'); fixture.detectChanges();
    expect(component.cards().find(card => card.id === 'body_weight')!.settings.sourceKey).toBe('manual-source');
    fixture.componentRef.setInput('user', { uid: 'owner', settings: { unitSettings: { weightUnits: ['Pounds'] } } }); fixture.detectChanges();
    expect(component.cards().find(card => card.id === 'body_weight')!.settings.sourceKey).toBe('manual-source');
    component.updateCardSettings({ metric: 'body_weight', range: '1y', sourceKey: 'other' });
    expect(component.cards().find(card => card.id === 'body_weight')!.settings.sourceKey).toBe('manual-source');
    fixture.componentRef.setInput('user', { uid: 'new-owner', settings: { unitSettings: {} } }); fixture.detectChanges();
    expect(component.cards().find(card => card.id === 'body_weight')!.settings.sourceKey).toBeUndefined(); expect(component.selectedCategory()).toBe('all');
  });
  it('restores per-metric preferences on a fresh visit without emitting saves or hiding missing choices', () => {
    const fixture = create(), component = fixture.componentInstance, saved = vi.fn();
    component.sourceSelected.subscribe(saved);
    fixture.componentRef.setInput('user', { uid: 'owner', settings: { unitSettings: {}, appSettings: { healthWorkspace: {
      metricSources: { body_weight: 'health-series-0123456789abcdef', vo2_max: 'health-series-abcdef0123456789' },
    } } } }); fixture.detectChanges();
    expect(component.cards().find(card => card.id === 'body_weight')?.settings.sourceKey).toBe('health-series-0123456789abcdef');
    expect(component.cards().find(card => card.id === 'vo2_max')?.settings.sourceKey).toBe('health-series-abcdef0123456789');
    component.observeSources(emptyContext('body_weight')); fixture.detectChanges();
    expect(component.cards().find(card => card.id === 'body_weight')?.hidden).toBe(false);
    expect(saved).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
    fixture.componentRef.setInput('user', { uid: 'new-owner', settings: { unitSettings: {} } }); fixture.detectChanges();
    expect(component.cards().find(card => card.id === 'body_weight')?.settings.sourceKey).toBeUndefined();
  });
  it('emits only accepted explicit source choices and never persists an example or automatic choice', () => {
    const fixture = create(), component = fixture.componentInstance, saved = vi.fn();
    component.sourceSelected.subscribe(saved);
    const settings = { metric: 'body_weight' as const, range: '30d' as const, sourceKey: 'health-series-0123456789abcdef' };
    component.updateCardSettings(settings, true);
    expect(saved).not.toHaveBeenCalled();
    component.updateCardSettings({ ...settings, sourceKey: 'health-series-abcdef0123456789' });
    expect(saved).toHaveBeenCalledExactlyOnceWith({ uid: 'owner', metric: 'body_weight', sourceKey: 'health-series-abcdef0123456789' });
    component.updateCardSettings({ ...settings, sourceKey: 'health-series-abcdef0123456789' });
    fixture.componentRef.setInput('exampleOnly', true); fixture.detectChanges();
    component.updateCardSettings(settings);
    expect(saved).toHaveBeenCalledTimes(1); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('announces preference saves in a stable overview status slot without hiding cards', () => {
    const fixture = create(), component = fixture.componentInstance;
    const cards = component.cards().length;
    const status = fixture.nativeElement.querySelector('.health-overview-save-status') as HTMLElement;
    expect(status).not.toBeNull(); expect(status.querySelector('mat-spinner')).toBeNull();
    fixture.componentRef.setInput('savingPreferences', true); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.health-overview-save-status')).toBe(status);
    expect(status.textContent).toContain('Saving Health preferences'); expect(status.querySelector('mat-spinner')).not.toBeNull();
    expect(component.cards()).toHaveLength(cards);
    fixture.componentRef.setInput('savingPreferences', false); fixture.detectChanges();
    expect(status.textContent?.trim()).toBe(''); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('persists only an opaque Sleep source identity while retaining the selected account locally', () => {
    const fixture = create(), component = fixture.componentInstance, saved = vi.fn();
    component.sourceSelected.subscribe(saved);
    const rawSource = JSON.stringify(['SuuntoApp', 'private-account']);
    component.updateCardSettings({ metric: 'sleep', range: '30d', sourceKey: rawSource });
    expect(saved).toHaveBeenCalledExactlyOnceWith({ uid: 'owner', metric: 'sleep', sourceKey: expect.stringMatching(/^health-series-[a-f0-9]{16}$/) });
    expect(JSON.stringify(saved.mock.calls)).not.toContain('private-account');
    expect(component.cards().find(card => card.id === 'sleep')?.settings.sourceKey).toBe(rawSource);
  });
  it('emits history navigation once, leaves feedback to the workspace and handles empty or removed categories', () => {
    const fixture = create(), component = fixture.componentInstance, selected = vi.fn();
    component.metricSelected.subscribe(selected);
    fixture.nativeElement.querySelector('button[aria-label="View Body weight history"]').click();
    expect(selected).toHaveBeenCalledExactlyOnceWith('body_weight'); expect(haptics.selection).not.toHaveBeenCalled();
    component.selectCategory('body');
    fixture.componentRef.setInput('groups', []); fixture.componentRef.setInput('showSleep', false); fixture.detectChanges();
    expect(component.selectedCategory()).toBe('all'); expect(component.cards()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('No recorded Health metrics yet');
  });
});

describe('Health overview reader lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('restarts omitted readers after category browsing and reveals a failed refresh with retry access', async () => {
    vi.stubGlobal('IntersectionObserver', vi.fn(function () {
      return { observe: vi.fn(), disconnect: vi.fn() };
    }));
    const streams: { metric: string; stream: Subject<DashboardHealthEvidence> }[] = [];
    const watch = vi.fn((_uid: string, settings: AppDashboardHealthMetricSettings) => {
      const stream = new Subject<DashboardHealthEvidence>();
      streams.push({ metric: settings.metric, stream }); return stream;
    });
    const haptics = { selection: vi.fn() };
    await TestBed.configureTestingModule({ imports: [HealthCategoryOverviewComponent, NoopAnimationsModule], providers: [
      { provide: AppHapticsService, useValue: haptics },
      { provide: DashboardHealthService, useValue: { isOwner: () => true, watch, invalidate: vi.fn() } },
    ] }).overrideComponent(DashboardHealthChartComponent, { set: { template: '', imports: [] } }).compileComponents();
    const fixture = TestBed.createComponent(HealthCategoryOverviewComponent);
    fixture.componentRef.setInput('user', { uid: 'owner', settings: { unitSettings: {}, appSettings: {} } });
    fixture.componentRef.setInput('groups', buildHealthMetricCatalogGroups(['body_weight', 'vo2_max']));
    fixture.componentRef.setInput('referenceDate', '2026-10-11'); fixture.detectChanges();
    const chartForWeight = () => fixture.debugElement.queryAll(By.directive(DashboardHealthChartComponent))
      .find(item => item.componentInstance.settings().metric === 'body_weight')!.componentInstance as DashboardHealthChartComponent;
    chartForWeight()['visible'].set(true); fixture.detectChanges();
    const empty: DashboardHealthEvidence = {
      window: resolveHealthWorkspaceWindow({ metric: 'body_weight', range: '30d', endDate: '2026-10-11' }),
      health: null, history: null, activities: null, sessions: [], errors: [],
    };
    streams[0].stream.next(empty); fixture.detectChanges();
    const weightCard = () => fixture.nativeElement.querySelector('[aria-labelledby="health-overview-body_weight"]') as HTMLElement;
    expect(weightCard().hidden).toBe(true);
    fixture.componentInstance.selectCategory('fitness'); fixture.detectChanges();
    expect(streams[0].stream.observed).toBe(false);
    fixture.componentInstance.selectCategory('all'); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(weightCard().querySelector('app-dashboard-health-chart')?.getAttribute('data-chart-preload')).toBe('background');
    expect(streams.filter(item => item.metric === 'body_weight')).toHaveLength(2);
    expect(weightCard().hidden).toBe(true);
    streams[1].stream.error(new Error('refresh failed')); fixture.detectChanges();
    expect(weightCard().hidden).toBe(false);
    expect(chartForWeight().error()).toBe(true);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    chartForWeight().reload(); fixture.detectChanges();
    expect(streams.filter(item => item.metric === 'body_weight')).toHaveLength(3);
    streams[2].stream.next(empty); fixture.detectChanges();
    expect(weightCard().hidden).toBe(true);
    expect(chartForWeight().error()).toBe(false);
    expect(haptics.selection).toHaveBeenCalledTimes(3);
    fixture.destroy();
  });
});
