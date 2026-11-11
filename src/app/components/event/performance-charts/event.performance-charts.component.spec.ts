import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { EventPerformanceChartsComponent } from './event.performance-charts.component';
import { EventSectionHeaderComponent } from '../section-header/event.section-header.component';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';

describe('EventPerformanceChartsComponent', () => {
  let fixture: ComponentFixture<EventPerformanceChartsComponent>;
  let component: EventPerformanceChartsComponent;
  const chartSettings = signal<{ showPerformanceCharts?: boolean }>({});
  const updateChartSettings = vi.fn();
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const snackBar = { open: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks(); chartSettings.set({});
    updateChartSettings.mockImplementation(async settings => { chartSettings.set(settings); });
    await TestBed.configureTestingModule({
      imports: [MatTabsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, NoopAnimationsModule],
      declarations: [EventPerformanceChartsComponent, EventSectionHeaderComponent],
      providers: [{ provide: AppUserSettingsQueryService, useValue: { chartSettings, updateChartSettings } },
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
    const button = fixture.nativeElement.querySelector('.performance-disclosure') as HTMLButtonElement;
    expect(button.textContent).toContain('Hide'); expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Hide Intensity Zones, Power Curve');
    expect(updateChartSettings).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
    button.click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(button.textContent).toContain('Show'); expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Show Intensity Zones, Power Curve');
    expect(fixture.nativeElement.querySelector(`#${button.getAttribute('aria-controls')}`).hidden).toBe(true);
    expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-event-intensity-zones')).toBeNull();
    expect(updateChartSettings).toHaveBeenCalledExactlyOnceWith({ showPerformanceCharts: false }, { force: true, expectedUserID: 'viewer' });
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(haptics.success).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('activities', [{ getID: () => 'another-activity' }]); fixture.detectChanges();
    expect(component.expanded()).toBe(false);
    fixture.destroy();
    const next = TestBed.createComponent(EventPerformanceChartsComponent);
    next.componentRef.setInput('viewer', new User('viewer')); next.componentRef.setInput('hasIntensity', true);
    next.detectChanges(); await next.whenStable();
    expect(next.nativeElement.querySelector('.performance-disclosure').textContent).toContain('Show');
    expect(next.nativeElement.querySelector('app-event-intensity-zones')).toBeNull();
    next.nativeElement.querySelector('.performance-disclosure').click(); next.detectChanges(); await next.whenStable(); next.detectChanges();
    expect(next.nativeElement.querySelector('app-event-intensity-zones')).not.toBeNull();
    expect(chartSettings()).toEqual({ showPerformanceCharts: true });
  });

  it.each([
    { flags: [true, false, false, false], title: 'Intensity Zones' },
    { flags: [false, false, true, false], title: 'Durability' },
    { flags: [true, true, false, false], title: 'Intensity Zones · Power Curve' },
    { flags: [true, true, true, true], title: 'Intensity Zones · Power Curve · Durability · Cadence vs Power' },
  ])('names the available charts in the disclosure: $title', async ({ flags, title }) => {
    for (const [index, name] of ['hasIntensity', 'hasPowerCurve', 'hasDurability', 'hasCadencePower'].entries()) {
      fixture.componentRef.setInput(name, flags[index]);
    }
    fixture.detectChanges(); await fixture.whenStable();
    const heading = () => fixture.nativeElement.querySelector('.event-section-header-title').textContent.trim();
    expect(heading()).toBe(title);
    await component.toggleExpanded(); fixture.detectChanges();
    expect(heading()).toBe(title);
    expect(fixture.nativeElement.querySelector('.performance-disclosure').getAttribute('aria-label'))
      .toBe(`Show ${title.replaceAll(' · ', ', ')}`);
    fixture.componentRef.setInput('hasIntensity', false); fixture.componentRef.setInput('hasPowerCurve', true);
    fixture.componentRef.setInput('hasDurability', false); fixture.componentRef.setInput('hasCadencePower', false);
    fixture.detectChanges(); await fixture.whenStable();
    expect(heading()).toBe('Power Curve');
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(updateChartSettings).not.toHaveBeenCalled();
  });

  it('disables duplicate saves, shows progress, restores the saved state on failure and allows retry', async () => {
    fixture.componentRef.setInput('viewer', new User('viewer')); component.hasIntensity = true;
    let rejectSave: (error: Error) => void;
    updateChartSettings.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectSave = reject; }));
    fixture.detectChanges(); await fixture.whenStable();
    const save = component.toggleExpanded(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.performance-disclosure').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
    await component.toggleExpanded(); expect(updateChartSettings).toHaveBeenCalledOnce();
    rejectSave!(new Error('Offline')); await save; fixture.detectChanges(); await fixture.whenStable();
    expect(component.expanded()).toBe(true); expect(component.saving()).toBe(false);
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(haptics.error).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled(); expect(snackBar.open).toHaveBeenCalledOnce();
    await component.toggleExpanded(); fixture.detectChanges(); await fixture.whenStable();
    expect(component.expanded()).toBe(false); expect(haptics.success).toHaveBeenCalledOnce();
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

  it('should render tabs in locked order when multiple charts are available', async () => {
    component.hasIntensity = true;
    component.hasPowerCurve = true;
    component.hasDurability = true;
    component.hasCadencePower = true;

    fixture.detectChanges();
    await fixture.whenStable();

    const nativeElement = fixture.nativeElement as HTMLElement;
    expect(nativeElement.querySelector('mat-tab-group')).not.toBeNull();
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

    expect(nativeElement.querySelector('mat-tab-group')).toBeNull();
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

    expect(nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(nativeElement.querySelector('app-event-durability-curve')).toBeNull();
    expect(nativeElement.querySelector('.performance-durability-notice')).toBeNull();
  });

  it('hides the missing-output notice beside a single direct chart', () => {
    component.hasIntensity = true;
    component.durabilityOutputUnavailable = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-event-intensity-zones')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.performance-durability-notice')).toBeNull();
  });

  it('shows the missing-output notice only while multiple performance tabs are visible', () => {
    component.hasIntensity = true;
    component.hasPowerCurve = true;
    component.durabilityOutputUnavailable = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mat-tab-group')).not.toBeNull();
    expect(component.availableTabs).toEqual(['intensity', 'powerCurve']);
    expect(fixture.nativeElement.querySelector('.performance-durability-notice')?.textContent)
      .toContain('No selected activity has supported output data');

    fixture.componentRef.setInput('hasPowerCurve', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(fixture.nativeElement.querySelector('.performance-durability-notice')).toBeNull();
  });

  it('does not claim durability is missing when its tab is available', () => {
    component.hasIntensity = true;
    component.hasDurability = true;
    component.durabilityOutputUnavailable = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mat-tab-group')).not.toBeNull();
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

    expect(nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(nativeElement.querySelector('app-event-cadence-power')).not.toBeNull();
  });

  it('should render nothing when no charts are available', () => {
    component.hasIntensity = false;
    component.hasPowerCurve = false;
    component.hasDurability = false;
    component.hasCadencePower = false;

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;

    expect(nativeElement.querySelector('mat-tab-group')).toBeNull();
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
