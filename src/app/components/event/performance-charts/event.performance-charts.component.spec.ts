import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, Input, NO_ERRORS_SCHEMA, TemplateRef, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { BreakpointObserver } from '@angular/cdk/layout';
import { BehaviorSubject } from 'rxjs';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { User } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { EventPerformanceChartsComponent } from './event.performance-charts.component';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { CompactSelectComponent } from '../../shared/compact-select/compact-select.component';

@Component({
  selector: 'app-event-intensity-zones, app-event-power-curve, app-event-durability-curve, app-event-cadence-power',
  imports: [NgTemplateOutlet],
  template: '<div class="chart-intro"><ng-container [ngTemplateOutlet]="headerActions"></ng-container></div>',
})
class PerformanceChartStubComponent {
  @Input() headerActions: TemplateRef<unknown> | null = null;
}

describe('EventPerformanceChartsComponent', () => {
  let fixture: ComponentFixture<EventPerformanceChartsComponent>;
  let component: EventPerformanceChartsComponent;
  const chartSettings = signal<{ showPerformanceCharts?: boolean }>({});
  const updateChartSettings = vi.fn();
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const snackBar = { open: vi.fn() };
  const breakpoint = new BehaviorSubject({ matches: false, breakpoints: {} });

  beforeEach(async () => {
    vi.clearAllMocks(); chartSettings.set({}); breakpoint.next({ matches: false, breakpoints: {} });
    updateChartSettings.mockImplementation(async settings => { chartSettings.set(settings); });
    await TestBed.configureTestingModule({
      imports: [NgTemplateOutlet, CompactSelectComponent, PerformanceChartStubComponent, MatTabsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, NoopAnimationsModule],
      declarations: [EventPerformanceChartsComponent],
      providers: [{ provide: AppUserSettingsQueryService, useValue: { chartSettings, updateChartSettings } },
        { provide: BreakpointObserver, useValue: { observe: () => breakpoint.asObservable() } },
        { provide: AppHapticsService, useValue: haptics }, { provide: MatSnackBar, useValue: snackBar }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(EventPerformanceChartsComponent);
    component = fixture.componentInstance;
    component.activities = [{ getID: () => 'a1' } as any];
  });

  it('starts visible, remembers Hide across activities and fresh views, and keeps its disclosure target available', async () => {
    fixture.componentRef.setInput('viewer', new User('viewer'));
    component.hasIntensity = true; component.hasPowerCurve = true;
    fixture.detectChanges(); await fixture.whenStable();
    let button = fixture.nativeElement.querySelector('.performance-disclosure') as HTMLButtonElement;
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Hide performance charts');
    expect(button.querySelector('.performance-disclosure-label').textContent).toBe('Hide');
    expect(button.closest('.performance-charts-toolbar').querySelector('nav')).not.toBeNull();
    const controlledRegion = fixture.nativeElement.querySelector(`#${button.getAttribute('aria-controls')}`) as HTMLElement;
    expect(controlledRegion.getAttribute('aria-label')).toBe('Performance charts');
    expect(controlledRegion.contains(fixture.nativeElement.querySelector('.performance-charts-tabs'))).toBe(true);
    expect(controlledRegion.contains(fixture.nativeElement.querySelector('app-event-intensity-zones'))).toBe(true);
    expect(updateChartSettings).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
    button.click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    button = fixture.nativeElement.querySelector('.performance-disclosure') as HTMLButtonElement;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Show performance charts');
    expect(button.textContent).toContain('Show performance charts');
    expect(fixture.nativeElement.querySelector(`#${button.getAttribute('aria-controls')}`).hidden).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('app-event-intensity-zones')).toBeNull();
    expect(updateChartSettings).toHaveBeenCalledExactlyOnceWith({ showPerformanceCharts: false }, { force: true, expectedUserID: 'viewer' });
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(haptics.success).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('activities', [{ getID: () => 'another-activity' }]); fixture.detectChanges();
    expect(component.expanded()).toBe(false);
    fixture.destroy();
    const next = TestBed.createComponent(EventPerformanceChartsComponent);
    next.componentRef.setInput('viewer', new User('viewer')); next.componentRef.setInput('hasIntensity', true);
    next.detectChanges(); await next.whenStable();
    expect(next.nativeElement.querySelector('.performance-disclosure').getAttribute('aria-label')).toBe('Show performance charts');
    expect(next.nativeElement.querySelector('app-event-intensity-zones')).toBeNull();
    next.nativeElement.querySelector('.performance-disclosure').click(); next.detectChanges(); await next.whenStable(); next.detectChanges();
    expect(next.nativeElement.querySelector('app-event-intensity-zones')).not.toBeNull();
    expect(chartSettings()).toEqual({ showPerformanceCharts: true });
  });

  it.each([
    { flags: [true, false, false, false], names: ['Intensity Zones'] },
    { flags: [false, false, true, false], names: ['Durability'] },
    { flags: [true, true, false, false], names: ['Intensity', 'Power Curve'] },
    { flags: [true, true, true, true], names: ['Intensity', 'Power Curve', 'Durability', 'Cadence vs Power'] },
  ])('collapses the complete chart section into one reveal row: $names', async ({ flags, names }) => {
    for (const [index, name] of ['hasIntensity', 'hasPowerCurve', 'hasDurability', 'hasCadencePower'].entries()) {
      fixture.componentRef.setInput(name, flags[index]);
    }
    fixture.detectChanges(); await fixture.whenStable();
    const labels = () => Array.from(fixture.nativeElement.querySelectorAll('.performance-tab-text'))
      .map((label: Element) => label.textContent.trim());
    expect(labels()).toEqual(names.length > 1 ? names : []);
    expect(component.chartTitles).toEqual(names.map(name => name === 'Intensity' ? 'Intensity Zones' : name));
    expect(fixture.nativeElement.querySelector('mat-tab-nav-panel').getAttribute('role')).toBe(names.length > 1 ? 'tabpanel' : 'region');
    const hide = fixture.nativeElement.querySelector('.performance-disclosure') as HTMLButtonElement;
    expect(hide.closest(names.length > 1 ? '.performance-charts-toolbar' : '.chart-intro')).not.toBeNull();
    await component.toggleExpanded(); fixture.detectChanges();
    expect(labels()).toEqual([]);
    expect(fixture.nativeElement.querySelector('.performance-disclosure').getAttribute('aria-label'))
      .toBe('Show performance charts');
    expect(fixture.nativeElement.querySelector('app-event-intensity-zones, app-event-power-curve, app-event-durability-curve, app-event-cadence-power')).toBeNull();
    fixture.componentRef.setInput('hasIntensity', false); fixture.componentRef.setInput('hasPowerCurve', true);
    fixture.componentRef.setInput('hasDurability', false); fixture.componentRef.setInput('hasCadencePower', false);
    fixture.detectChanges(); await fixture.whenStable();
    expect(labels()).toEqual([]);
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(updateChartSettings).not.toHaveBeenCalled();
  });

  it('changes visible tabs without saving visibility and ignores chart selection while collapsed', async () => {
    fixture.componentRef.setInput('viewer', new User('viewer'));
    component.hasIntensity = true; component.hasPowerCurve = true;
    fixture.detectChanges(); await fixture.whenStable();
    const tabs = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[1].click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(component.activeTab).toBe('powerCurve'); expect(component.expanded()).toBe(true);
    expect(fixture.nativeElement.querySelector('app-event-power-curve')).not.toBeNull();
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(updateChartSettings).not.toHaveBeenCalled();
    tabs[1].click(); fixture.detectChanges(); await fixture.whenStable();
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(updateChartSettings).not.toHaveBeenCalled();
    tabs[0].click(); fixture.detectChanges(); await fixture.whenStable();
    expect(component.activeTab).toBe('intensity'); expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(updateChartSettings).not.toHaveBeenCalled();
    await component.toggleExpanded(); fixture.detectChanges(); await fixture.whenStable();
    expect(updateChartSettings).toHaveBeenCalledExactlyOnceWith({ showPerformanceCharts: false }, { force: true, expectedUserID: 'viewer' });
    await component.selectChart('powerCurve');
    expect(component.expanded()).toBe(false); expect(component.activeTab).toBe('intensity');
    expect(haptics.selection).toHaveBeenCalledTimes(3); expect(updateChartSettings).toHaveBeenCalledOnce();
  });

  it('disables duplicate saves, shows progress, restores the saved state on failure and allows retry', async () => {
    fixture.componentRef.setInput('viewer', new User('viewer')); component.hasIntensity = true; component.hasPowerCurve = true;
    let rejectSave: (error: Error) => void;
    updateChartSettings.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectSave = reject; }));
    fixture.detectChanges(); await fixture.whenStable();
    const save = component.toggleExpanded(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.performance-disclosure').getAttribute('aria-disabled')).toBe('true');
    expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[role="tab"]')).toHaveLength(0);
    await component.selectChart('powerCurve'); expect(component.activeTab).toBe('intensity');
    await component.toggleExpanded(); expect(updateChartSettings).toHaveBeenCalledOnce();
    rejectSave!(new Error('Offline')); await save; fixture.detectChanges(); await fixture.whenStable();
    expect(component.expanded()).toBe(true); expect(component.saving()).toBe(false);
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(haptics.error).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled(); expect(snackBar.open).toHaveBeenCalledOnce();
    await component.toggleExpanded(); fixture.detectChanges(); await fixture.whenStable();
    expect(component.expanded()).toBe(false); expect(haptics.success).toHaveBeenCalledOnce();
  });

  it('keeps focus on the disclosure while saving and blocks repeated activation', async () => {
    fixture.componentRef.setInput('viewer', new User('viewer'));
    component.hasIntensity = true;
    let finishSave: () => void;
    updateChartSettings.mockImplementationOnce(settings => new Promise<void>(resolveSave => {
      finishSave = () => { chartSettings.set(settings); resolveSave(); };
    }));
    fixture.detectChanges(); await fixture.whenStable();
    let button = fixture.nativeElement.querySelector('.performance-disclosure') as HTMLButtonElement;
    button.focus(); button.click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    button = fixture.nativeElement.querySelector('.performance-disclosure') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(button);
    button.click(); fixture.detectChanges();
    expect(updateChartSettings).toHaveBeenCalledOnce(); expect(haptics.selection).toHaveBeenCalledOnce();
    finishSave!(); await fixture.whenStable(); fixture.detectChanges();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(button.getAttribute('aria-busy')).toBe('false');
  });

  it('keeps anonymous shared views local and ignores late failures after the viewer changes', async () => {
    component.hasIntensity = true; fixture.detectChanges(); await fixture.whenStable();
    await component.toggleExpanded(); fixture.detectChanges();
    expect(component.expanded()).toBe(false); expect(updateChartSettings).not.toHaveBeenCalled();
    fixture.componentRef.setInput('viewer', new User('first')); fixture.detectChanges(); await fixture.whenStable();
    expect(component.expanded()).toBe(true);
    let rejectSave: (error: Error) => void;
    updateChartSettings.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectSave = reject; }));
    const save = component.toggleExpanded(); fixture.detectChanges();
    fixture.componentRef.setInput('viewer', new User('second')); fixture.detectChanges(); await fixture.whenStable();
    expect(component.expanded()).toBe(true); expect(component.saving()).toBe(false);
    rejectSave!(new Error('Old account')); await save; fixture.detectChanges();
    expect(haptics.error).not.toHaveBeenCalled(); expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('preserves the active tab when hiding and showing the charts', async () => {
    component.hasIntensity = true; component.hasPowerCurve = true;
    fixture.detectChanges(); await fixture.whenStable();
    const tabs = fixture.nativeElement.querySelectorAll('[role="tab"]');
    (tabs[1] as HTMLElement).click(); fixture.detectChanges(); await fixture.whenStable();
    await component.toggleExpanded(); fixture.detectChanges(); await fixture.whenStable();
    await component.toggleExpanded(); fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Power Curve');
  });

  it('uses one header row on phones and changes charts without changing saved visibility', async () => {
    component.hasIntensity = true; component.hasPowerCurve = true; component.hasCadencePower = true;
    breakpoint.next({ matches: true, breakpoints: {} });
    fixture.detectChanges(); await fixture.whenStable();
    const picker = fixture.debugElement.query(By.directive(CompactSelectComponent));
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();
    expect(picker.nativeElement.closest('.performance-charts-toolbar').querySelector('.performance-disclosure')).not.toBeNull();
    expect(picker.componentInstance.hideLabel()).toBe(true);
    picker.componentInstance.select('cadencePower'); fixture.detectChanges(); await fixture.whenStable();
    expect(component.activeTab).toBe('cadencePower');
    expect(fixture.nativeElement.querySelector('mat-tab-nav-panel').getAttribute('role')).toBe('region');
    expect(fixture.nativeElement.querySelector('mat-tab-nav-panel').getAttribute('aria-label')).toBe('Cadence vs Power');
    expect(updateChartSettings).not.toHaveBeenCalled(); expect(haptics.selection).toHaveBeenCalledOnce();
    picker.componentInstance.select('cadencePower');
    expect(haptics.selection).toHaveBeenCalledOnce();
    await component.toggleExpanded(); fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(CompactSelectComponent))).toBeNull();
  });

  it('keeps panel labels valid when switching between tabs, the phone picker and a single chart', async () => {
    component.hasIntensity = true; component.hasPowerCurve = true;
    fixture.detectChanges(); await fixture.whenStable();
    const panel = fixture.nativeElement.querySelector('mat-tab-nav-panel') as HTMLElement;
    const expectLinkedTab = () => {
      expect(panel.getAttribute('role')).toBe('tabpanel');
      const labelID = panel.getAttribute('aria-labelledby');
      expect(labelID).toBeTruthy();
      const tab = fixture.nativeElement.querySelector(`#${labelID}`) as HTMLButtonElement;
      expect(tab).not.toBeNull();
      expect(tab.getAttribute('aria-selected')).toBe('true');
      expect(tab.getAttribute('aria-controls')).toBe(panel.id);
    };
    expectLinkedTab();
    expect(updateChartSettings).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();

    breakpoint.next({ matches: true, breakpoints: {} });
    fixture.detectChanges(); await fixture.whenStable();
    expect(panel.getAttribute('role')).toBe('region');
    expect(panel.getAttribute('aria-labelledby')).toBeNull();
    expect(panel.getAttribute('aria-label')).toBe('Intensity');

    fixture.debugElement.query(By.directive(CompactSelectComponent)).componentInstance.select('powerCurve');
    fixture.componentRef.setInput('hasIntensity', false);
    fixture.detectChanges(); await fixture.whenStable();
    breakpoint.next({ matches: false, breakpoints: {} });
    fixture.detectChanges(); await fixture.whenStable();
    expect(panel.getAttribute('role')).toBe('region');
    expect(panel.getAttribute('aria-labelledby')).toBeNull();
    expect(panel.getAttribute('aria-label')).toBe('Power Curve');

    fixture.componentRef.setInput('hasIntensity', true);
    fixture.detectChanges(); await fixture.whenStable();
    expectLinkedTab();
    await component.toggleExpanded(); fixture.detectChanges(); await fixture.whenStable();
    expect(panel.getAttribute('aria-labelledby')).toBeNull();
    await component.toggleExpanded(); fixture.detectChanges(); await fixture.whenStable();
    expectLinkedTab();
    expect(updateChartSettings).not.toHaveBeenCalled();
  });

  it('should render tabs in locked order when multiple charts are available', async () => {
    component.hasIntensity = true;
    component.hasPowerCurve = true;
    component.hasDurability = true;
    component.hasCadencePower = true;

    fixture.detectChanges();
    await fixture.whenStable();

    const nativeElement = fixture.nativeElement as HTMLElement;
    expect(nativeElement.querySelector('nav[mat-tab-nav-bar]')).not.toBeNull();
    expect(Array.from(nativeElement.querySelectorAll('[role="tab"]')).map(tab => tab.getAttribute('aria-label')))
      .toEqual(['Intensity', 'Power Curve', 'Durability', 'Cadence vs Power']);

    const icons = Array.from(nativeElement.querySelectorAll('.performance-tab-icon'))
      .map((icon) => icon.textContent?.trim())
      .filter((value): value is string => !!value);
    expect(icons).toEqual(['stacked_bar_chart', 'line_curve', 'line_axis', 'key_visualizer']);
  });

  it('should render direct durability chart without tabs when only durability is available', () => {
    component.hasIntensity = false;
    component.hasPowerCurve = false;
    component.hasDurability = true;
    component.hasCadencePower = false;

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;

    expect(nativeElement.querySelector('nav[mat-tab-nav-bar]')).toBeNull();
    expect(nativeElement.querySelector('app-event-durability-curve')).not.toBeNull();
  });

  it('hides the missing-output durability notice when no performance tabs exist', () => {
    component.hasIntensity = false;
    component.hasPowerCurve = false;
    component.hasDurability = false;
    component.durabilityOutputUnavailable = true;
    component.hasCadencePower = false;

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;

    expect(nativeElement.querySelector('nav[mat-tab-nav-bar]')).toBeNull();
    expect(nativeElement.querySelector('app-event-durability-curve')).toBeNull();
    expect(nativeElement.querySelector('.performance-durability-notice')).toBeNull();
  });

  it('hides the missing-output notice beside a single direct chart', () => {
    component.hasIntensity = true;
    component.durabilityOutputUnavailable = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('nav[mat-tab-nav-bar]')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-event-intensity-zones')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.performance-durability-notice')).toBeNull();
  });

  it('shows the missing-output notice only while multiple performance tabs are visible', () => {
    component.hasIntensity = true;
    component.hasPowerCurve = true;
    component.durabilityOutputUnavailable = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('nav[mat-tab-nav-bar]')).not.toBeNull();
    expect(component.availableTabs).toEqual(['intensity', 'powerCurve']);
    expect(fixture.nativeElement.querySelector('.performance-durability-notice')?.textContent)
      .toContain('No selected activity has supported output data');

    fixture.componentRef.setInput('hasPowerCurve', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('nav[mat-tab-nav-bar]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.performance-durability-notice')).toBeNull();
  });

  it('does not claim durability is missing when its tab is available', () => {
    component.hasIntensity = true;
    component.hasDurability = true;
    component.durabilityOutputUnavailable = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('nav[mat-tab-nav-bar]')).not.toBeNull();
    expect(component.availableTabs).toContain('durability');
    expect(fixture.nativeElement.querySelector('.performance-durability-notice')).toBeNull();
  });

  it('should render direct cadence-power chart without tabs when only cadence-power is available', () => {
    component.hasIntensity = false;
    component.hasPowerCurve = false;
    component.hasDurability = false;
    component.hasCadencePower = true;

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;

    expect(nativeElement.querySelector('nav[mat-tab-nav-bar]')).toBeNull();
    expect(nativeElement.querySelector('app-event-cadence-power')).not.toBeNull();
  });

  it('should render nothing when no charts are available', () => {
    component.hasIntensity = false;
    component.hasPowerCurve = false;
    component.hasDurability = false;
    component.hasCadencePower = false;

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;

    expect(nativeElement.querySelector('nav[mat-tab-nav-bar]')).toBeNull();
    expect(nativeElement.querySelector('app-event-intensity-zones')).toBeNull();
    expect(nativeElement.querySelector('app-event-power-curve')).toBeNull();
    expect(nativeElement.querySelector('app-event-power-system-strain')).toBeNull();
    expect(nativeElement.querySelector('app-event-durability-curve')).toBeNull();
    expect(nativeElement.querySelector('app-event-cadence-power')).toBeNull();
    expect(nativeElement.querySelector('app-event-dive-profile')).toBeNull();
  });

  it('never exposes the retired power-system strain tab', () => {
    component.hasPowerCurve = true;
    component.hasDurability = true;

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Power-system strain');
    expect(fixture.nativeElement.querySelector('app-event-power-system-strain')).toBeNull();
  });

});

it('reserves the taller shared performance chart height', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/event/performance-charts/event.performance-charts.component.css'),
      'utf8',
    );

    expect(styles).toContain('--performance-chart-height: 23.1vh;');
});
