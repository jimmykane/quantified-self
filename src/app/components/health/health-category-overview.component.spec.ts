import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { HealthCategoryOverviewComponent } from './health-category-overview.component';
import { DashboardHealthChartComponent } from '../charts/health/dashboard-health-chart.component';
import { AppHapticsService } from '../../services/app.haptics.service';
import { buildHealthMetricCatalogGroups } from '../../helpers/health-workspace.helper';
import type { AppDashboardHealthMetricSettings } from '../../models/app-user.interface';
import type { DashboardHealthContext } from '../../helpers/dashboard-health-context.helper';

@Component({ selector: 'app-dashboard-health-chart', standalone: true, template: '' })
class HealthChartStubComponent {
  readonly user = input.required();
  readonly settings = input.required<AppDashboardHealthMetricSettings>();
  readonly overview = input(false);
  readonly hideTitle = input(false);
  readonly darkTheme = input(false);
  readonly referenceDate = input(null);
  readonly providerFilter = input([]);
  readonly timelineNotes = input(null);
  readonly settingsChange = output<{ settings: AppDashboardHealthMetricSettings; initial: boolean }>();
  readonly contextChange = output<DashboardHealthContext>();
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
  it('opens with six real catalog cards and forwards shared chart inputs without example data', () => {
    const fixture = create(), component = fixture.componentInstance;
    expect(component.cards().map(card => card.id)).toEqual(['body_weight', 'heart_rate_variability', 'resting_heart_rate', 'steps', 'vo2_max', 'sleep']);
    const chart = fixture.debugElement.query(By.directive(HealthChartStubComponent)).componentInstance as HealthChartStubComponent;
    expect(chart.overview()).toBe(true);
    expect(chart.settings()).toEqual({ metric: 'body_weight', range: '30d' });
    fixture.componentRef.setInput('providerFilter', ['GarminAPI']); fixture.componentRef.setInput('darkTheme', true); fixture.detectChanges();
    expect(chart.providerFilter()).toEqual(['GarminAPI']); expect(chart.darkTheme()).toBe(true);
    fixture.componentRef.setInput('referenceDate', '2026-10-10'); fixture.detectChanges();
    expect(chart.referenceDate()).toBe('2026-10-10');
    expect(haptics.selection).not.toHaveBeenCalled();
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
    chart.contextChange.emit({ sources: [{ provider: 'QuantifiedSelf' }, { provider: 'GarminAPI' }, { provider: 'GarminAPI' }] } as DashboardHealthContext);
    expect(reported).toHaveBeenCalledExactlyOnceWith({ uid: 'owner', providers: ['QuantifiedSelf', 'GarminAPI'] });
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('keeps source choices across category changes and clears them when the account changes', () => {
    const fixture = create(), component = fixture.componentInstance;
    component.updateCardSettings({ metric: 'body_weight', range: '30d', sourceKey: 'manual-source' });
    component.selectCategory('fitness'); component.selectCategory('all'); fixture.detectChanges();
    expect(component.cards()[0].settings.sourceKey).toBe('manual-source');
    fixture.componentRef.setInput('user', { uid: 'owner', settings: { unitSettings: { weightUnits: ['Pounds'] } } }); fixture.detectChanges();
    expect(component.cards()[0].settings.sourceKey).toBe('manual-source');
    component.updateCardSettings({ metric: 'body_weight', range: '1y', sourceKey: 'other' });
    expect(component.cards()[0].settings.sourceKey).toBe('manual-source');
    fixture.componentRef.setInput('user', { uid: 'new-owner', settings: { unitSettings: {} } }); fixture.detectChanges();
    expect(component.cards()[0].settings.sourceKey).toBeUndefined(); expect(component.selectedCategory()).toBe('all');
  });
  it('emits history navigation once, leaves feedback to the workspace and handles empty or removed categories', () => {
    const fixture = create(), component = fixture.componentInstance, selected = vi.fn();
    component.metricSelected.subscribe(selected);
    fixture.nativeElement.querySelector('mat-card-actions button').click();
    expect(selected).toHaveBeenCalledExactlyOnceWith('body_weight'); expect(haptics.selection).not.toHaveBeenCalled();
    component.selectCategory('body');
    fixture.componentRef.setInput('groups', []); fixture.componentRef.setInput('showSleep', false); fixture.detectChanges();
    expect(component.selectedCategory()).toBe('all'); expect(component.cards()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('No recorded Health metrics yet');
  });
});
