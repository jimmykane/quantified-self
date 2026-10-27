import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { CommonModule } from '@angular/common';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { OverlayContainer } from '@angular/cdk/overlay';
import { By } from '@angular/platform-browser';
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule, type MatSlideToggleChange } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChartCursorBehaviours, EventInterface, User, XAxisTypes } from '@sports-alliance/sports-lib';
import { vi } from 'vitest';
import { EventCardChartActionsComponent } from './event.card.chart.actions.component';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';
import { AppHapticsService } from '../../../../services/app.haptics.service';
import { MenuRadioListComponent } from '../../../shared/menu-radio-list/menu-radio-list.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';

describe('EventCardChartActionsComponent', () => {
  let component: EventCardChartActionsComponent;
  let fixture: ComponentFixture<EventCardChartActionsComponent>;

  const hapticsServiceMock = { selection: vi.fn() };

  const analyticsServiceMock = {
    logEvent: vi.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        CommonModule,
        BrowserAnimationsModule,
        MatBadgeModule,
        MatButtonModule,
        MatDividerModule,
        MatIconModule,
        MatFormFieldModule,
        MatInputModule,
        MatMenuModule,
        MatProgressSpinnerModule,
        MatSliderModule,
        MatSlideToggleModule,
        MatTooltipModule,
      ],
      declarations: [EventCardChartActionsComponent, MenuRadioListComponent],
      providers: [
        { provide: AppHapticsService, useValue: hapticsServiceMock },
        { provide: AppAnalyticsService, useValue: analyticsServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventCardChartActionsComponent);
    component = fixture.componentInstance;
    component.user = { uid: 'test-user' } as User;
    component.event = { isMultiSport: () => false } as EventInterface;
    component.xAxisType = XAxisTypes.Duration;
    component.cursorBehaviour = ChartCursorBehaviours.ZoomX;
    component.showAllData = false;
    component.showLaps = false;
    component.showSwimLengths = false;
    component.showSwimLengthsToggle = false;
    component.syncChartHoverToMap = false;
    fixture.detectChanges();
    vi.clearAllMocks();
  });

  async function openOptionsMenu(): Promise<HTMLElement> {
    fixture.detectChanges();
    fixture.debugElement.query(By.css('button[aria-label="Chart options"]')).injector.get(MatMenuTrigger).openMenu();
    fixture.detectChanges();
    await fixture.whenStable();
    return TestBed.inject(OverlayContainer).getContainerElement();
  }

  async function openSettingsSubmenu(name: 'Line continuity' | 'X axis'): Promise<HTMLElement> {
    const overlay = await openOptionsMenu();
    overlay.querySelector<HTMLButtonElement>(`button[aria-label^="${name}:"]`)!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    return overlay;
  }

  function patternChange(checked: boolean): MatSlideToggleChange {
    return { checked, source: { checked: component.useDistinctLinePatterns } } as MatSlideToggleChange;
  }

  function zoneColorToggle(overlay: HTMLElement): HTMLButtonElement | undefined {
    return Array.from(overlay.querySelectorAll('mat-slide-toggle'))
      .find(toggle => toggle.textContent?.includes('Color by zones'))
      ?.querySelector('button[role="switch"]') as HTMLButtonElement | undefined;
  }

  it('shows Continuous by default and emits a mode choice while leaving feedback to the parent', async () => {
    component.canChangeLineContinuity = true;
    const emit = vi.spyOn(component.lineContinuityChange, 'emit');
    const overlay = await openSettingsSubmenu('Line continuity');
    const options = Array.from(overlay.querySelectorAll('app-menu-radio-list button'));
    expect(options.find(button => button.textContent?.includes('Continuous'))?.textContent).toContain('radio_button_checked');
    hapticsServiceMock.selection.mockClear();
    options.find(button => button.textContent?.includes('Detect gaps'))!.click();
    expect(emit).toHaveBeenCalledExactlyOnceWith({ mode: 'detect', maxGapSeconds: 10 });
    expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
    expect(overlay.textContent).toContain('Saved to your chart settings');
  });

  it('keeps choices in compact submenus and gives opening feedback without changing settings', async () => {
    component.canChangeLineContinuity = true;
    const continuity = vi.spyOn(component.lineContinuityChange, 'emit');
    const axis = vi.spyOn(component.xAxisTypeChange, 'emit');
    const overlay = await openOptionsMenu();
    expect(overlay.querySelector('app-menu-radio-list')).toBeNull();
    expect(overlay.querySelector('button[aria-label="Line continuity: Continuous"]')).toBeTruthy();
    expect(overlay.querySelector('button[aria-label="X axis: Duration"]')).toBeTruthy();
    expect(hapticsServiceMock.selection).toHaveBeenCalledOnce();

    overlay.querySelector<HTMLButtonElement>('button[aria-label="Line continuity: Continuous"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(overlay.querySelector('[role="menu"][aria-label="Line continuity"] app-menu-radio-list')).toBeTruthy();
    expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(2);
    expect(continuity).not.toHaveBeenCalled();
    expect(axis).not.toHaveBeenCalled();
    expect(analyticsServiceMock.logEvent).not.toHaveBeenCalled();
  });

  it('validates custom seconds while typing and saves a valid committed value only', async () => {
    component.canChangeLineContinuity = true;
    component.lineContinuity = { mode: 'custom', maxGapSeconds: 10 };
    const emit = vi.spyOn(component.lineContinuityChange, 'emit');
    const overlay = await openSettingsSubmenu('Line continuity');
    const input = overlay.querySelector('input[type="number"]') as HTMLInputElement;
    hapticsServiceMock.selection.mockClear();
    const type = (value: string) => {
      input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); fixture.detectChanges();
    };
    for (const value of ['', '0', '-1', '1.5', '86401']) {
      type(value); input.dispatchEvent(new Event('change', { bubbles: true }));
      expect(overlay.querySelector('[role="alert"]')).toBeTruthy();
      expect(input.getAttribute('aria-describedby')).toContain(component.gapLimitErrorID);
      expect(emit).not.toHaveBeenCalled();
    }
    type('20');
    expect(overlay.querySelector('[role="alert"]')).toBeNull();
    expect(emit).not.toHaveBeenCalled();
    component.lineContinuity = { mode: 'custom', maxGapSeconds: 10 }; // Unrelated settings snapshot.
    fixture.detectChanges();
    expect(input.value).toBe('20');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(emit).toHaveBeenCalledExactlyOnceWith({ mode: 'custom', maxGapSeconds: 20 });
    expect(input.value).toBe('20');
    component.lineContinuity = { mode: 'custom', maxGapSeconds: 20 };
    expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
    component.isSavingLineContinuity = true; fixture.detectChanges();
    expect(input.disabled).toBe(true);
    expect(input.value).toBe('20');
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(emit).toHaveBeenCalledOnce();
    component.lineContinuity = { mode: 'custom', maxGapSeconds: 10 }; // Parent rolls a failed save back.
    component.isSavingLineContinuity = false; fixture.detectChanges();
    expect(input.value).toBe('10');
    expect(overlay.textContent).toContain('Custom gap limit');
  });

  it('retains a custom-limit draft for retry when rejected before the parent renders', async () => {
    component.canChangeLineContinuity = true;
    component.lineContinuity = { mode: 'custom', maxGapSeconds: 10 };
    const emit = vi.spyOn(component.lineContinuityChange, 'emit');
    const overlay = await openSettingsSubmenu('Line continuity');
    const input = overlay.querySelector('input[type="number"]') as HTMLInputElement;
    input.value = '20';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // The parent rejects before exposing an optimistic settings snapshot.
    fixture.detectChanges();
    expect(component.lineContinuity.maxGapSeconds).toBe(10);
    expect(input.value).toBe('20');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith({ mode: 'custom', maxGapSeconds: 20 });
  });

  it('keeps unauthorized, pending and unchanged continuity requests silent', async () => {
    const emit = vi.spyOn(component.lineContinuityChange, 'emit');
    component.onLineContinuityModeChange('detect');
    component.canChangeLineContinuity = true;
    component.onLineContinuityModeChange('continuous');
    component.isSavingLineContinuity = true;
    component.onLineContinuityModeChange('custom');
    component.onGapLimitCommit();
    const overlay = await openSettingsSubmenu('Line continuity');
    expect(fixture.nativeElement.querySelector('[aria-label="Saving chart settings"]')).toBeTruthy();
    expect(Array.from(overlay.querySelectorAll('app-menu-radio-list:first-child button')).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(emit).not.toHaveBeenCalled();
    expect(analyticsServiceMock.logEvent).not.toHaveBeenCalled();
  });

  it('hides zone colors when unavailable, including comparisons', async () => {
    const overlay = await openOptionsMenu();
    expect(zoneColorToggle(overlay)).toBeUndefined();
  });

  it('renders zone colors enabled by default and emits the semantic change without duplicate haptics', async () => {
    component.showIntensityZoneColorsToggle = true;
    component.canChangeZoneColors = true;
    const emit = vi.spyOn(component.colorIntensityZoneLinesChange, 'emit');
    const overlay = await openOptionsMenu();
    const toggle = zoneColorToggle(overlay)!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    hapticsServiceMock.selection.mockClear();
    toggle.click();
    expect(emit).toHaveBeenCalledExactlyOnceWith(false);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'colorIntensityZoneLines' });
    expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-checked')).toBe('true'); // The parent owns saved state and rollback.
    expect(overlay.textContent).toContain('Color by zones'); // Keep the menu open.
  });

  it('renders the saved off choice and saving indicators while disabling further changes', async () => {
    component.showIntensityZoneColorsToggle = true;
    component.canChangeZoneColors = true;
    component.colorIntensityZoneLines = false;
    component.isSavingZoneColors = true;
    const emit = vi.spyOn(component.colorIntensityZoneLinesChange, 'emit');
    const overlay = await openOptionsMenu();
    const toggle = zoneColorToggle(overlay)!;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(toggle.tabIndex).toBe(0);
    expect(overlay.querySelector('[aria-label="Saving zone colors"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[aria-label="Saving chart settings"]')).toBeTruthy();
    toggle.click();
    expect(emit).not.toHaveBeenCalled();
  });

  it('ignores unavailable, unauthorized, pending and unchanged zone-color requests', () => {
    const emit = vi.spyOn(component.colorIntensityZoneLinesChange, 'emit');
    const change = () => ({ checked: false, source: { checked: false } }) as MatSlideToggleChange;
    component.onColorIntensityZoneLinesChange(change());
    component.showIntensityZoneColorsToggle = true;
    component.onColorIntensityZoneLinesChange(change());
    component.canChangeZoneColors = true;
    component.isSavingZoneColors = true;
    component.onColorIntensityZoneLinesChange(change());
    component.isSavingZoneColors = false;
    component.onColorIntensityZoneLinesChange({ checked: true, source: { checked: true } } as MatSlideToggleChange);
    component.user = null;
    component.onColorIntensityZoneLinesChange(change());
    expect(emit).not.toHaveBeenCalled();
    expect(analyticsServiceMock.logEvent).not.toHaveBeenCalled();
    expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
  });

  it('hides patterns for ordinary events and opens options with one haptic', async () => {
    expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
    const overlay = await openOptionsMenu();
    expect(overlay.querySelector('.chart-options-menu__pattern-row')).toBeNull();
    expect(hapticsServiceMock.selection).toHaveBeenCalledOnce();
  });

  it('renders the saved pattern choice and emits an accepted menu toggle once', async () => {
    component.showDistinctLinePatternsToggle = true;
    component.canChangeDistinctLinePatterns = true;
    component.useDistinctLinePatterns = true;
    const emit = vi.spyOn(component.distinctLinePatternsChange, 'emit');
    const overlay = await openOptionsMenu();
    const toggle = overlay.querySelector('.chart-options-menu__pattern-row button[role="switch"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    toggle.click();
    expect(emit).toHaveBeenCalledExactlyOnceWith(false);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'useDistinctComparisonLinePatterns' });
    expect(hapticsServiceMock.selection).toHaveBeenCalledOnce(); // The parent owns mutation feedback.
  });

  it('keeps the rendered switch off if its parent immediately rejects the change', async () => {
    component.showDistinctLinePatternsToggle = true;
    component.canChangeDistinctLinePatterns = true;
    const overlay = await openOptionsMenu();
    const toggle = overlay.querySelector('.chart-options-menu__pattern-row button[role="switch"]') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    expect(component.useDistinctLinePatterns).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('disables pending pattern changes and shows saving feedback in the menu and trigger', async () => {
    component.showDistinctLinePatternsToggle = true;
    component.canChangeDistinctLinePatterns = true;
    component.isSavingDistinctLinePatterns = true;
    const emit = vi.spyOn(component.distinctLinePatternsChange, 'emit');
    const overlay = await openOptionsMenu();
    const toggle = overlay.querySelector('.chart-options-menu__pattern-row button[role="switch"]') as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(toggle.tabIndex).toBe(0);
    expect(overlay.querySelector('[aria-label="Saving line patterns"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[aria-label="Saving chart settings"]')).toBeTruthy();
    component.onDistinctLinePatternsChange(patternChange(true));
    expect(emit).not.toHaveBeenCalled();
  });

  it('leaves unavailable and unchanged pattern choices silent', async () => {
    component.showDistinctLinePatternsToggle = true;
    const emit = vi.spyOn(component.distinctLinePatternsChange, 'emit');
    const overlay = await openOptionsMenu();
    const toggle = overlay.querySelector('.chart-options-menu__pattern-row button[role="switch"]') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    component.onDistinctLinePatternsChange(patternChange(true));
    component.canChangeDistinctLinePatterns = true;
    component.onDistinctLinePatternsChange(patternChange(false));
    expect(emit).not.toHaveBeenCalled();
    expect(analyticsServiceMock.logEvent).not.toHaveBeenCalled();
    expect(hapticsServiceMock.selection).toHaveBeenCalledOnce();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should keep menu panel classes in template', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/event/chart/actions/event.card.chart.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');
    expect(template).toMatch(/<mat-menu[^>]*class="[^"]*qs-menu-panel[^"]*qs-menu-panel-form[^"]*qs-config-menu[^"]*"/);
  });

  it('uses availability and visibility terminology in the chart menus', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/event/chart/actions/event.card.chart.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');

    expect(template).toContain('Include all recorded metrics');
    expect(template).toContain('Visible charts');
    expect(template).toContain(
      'Recommendations combine the selected sport, recorded metrics, and your Default chart metrics.',
    );
    expect(template).toContain('recommendedSeriesMenuLabel');
    expect(template).toContain('Other available');
    expect(template).toContain('Show all charts');
    expect(template).toContain('resetToSportDefaultsLabel');
    expect(template).toContain('aria-live="polite"');
    expect(template).not.toContain('Show All Data');
    expect(template).not.toContain('Show all data types');
  });

  it('should emit xAxisType changes and log analytics', async () => {
    const xAxisTypeEmitSpy = vi.spyOn(component.xAxisTypeChange, 'emit');

    await component.onXAxisTypeChange(XAxisTypes.Distance);

    expect(xAxisTypeEmitSpy).toHaveBeenCalledWith(XAxisTypes.Distance);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'xAxisType' });
  });

  it('disables distance x-axis option when unavailable', () => {
    component.canSelectDistanceXAxis = false;

    const distanceOption = component.xAxisOptions.find((option) => option.value === XAxisTypes.Distance);

    expect(distanceOption?.disabled).toBe(true);
  });

  it('renders disabled Distance with Duration and Time enabled in the axis menu', async () => {
    component.canSelectDistanceXAxis = false;
    const emit = vi.spyOn(component.xAxisTypeChange, 'emit');
    const overlay = await openSettingsSubmenu('X axis');
    const axisList = Array.from(overlay.querySelectorAll('app-menu-radio-list'))
      .find(list => list.textContent?.includes('X Axis'))!;
    const option = (label: string) => Array.from(axisList.querySelectorAll('button'))
      .find(button => button.querySelector('span')?.textContent?.trim() === label)!;
    hapticsServiceMock.selection.mockClear();

    expect(option('Duration').disabled).toBe(false);
    expect(option('Duration').textContent).toContain('radio_button_checked');
    expect(option('Time').disabled).toBe(false);
    expect(option('Distance').disabled).toBe(true);
    option('Duration').click();
    option('Distance').click();
    expect(emit).not.toHaveBeenCalled();
    expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
    expect(analyticsServiceMock.logEvent).not.toHaveBeenCalled();
    option('Time').click();
    expect(emit).toHaveBeenCalledExactlyOnceWith(XAxisTypes.Time);
    await component.onXAxisTypeChange(XAxisTypes.Time);
    expect(emit).toHaveBeenCalledOnce();
    // The parent validates the live activity selection and owns accepted-change feedback.
    expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
  });

  it.each(['signed out', 'multisport'])('ignores axis actions when the menu is disabled: %s', async (reason) => {
    if (reason === 'signed out') component.user = null;
    else component.event = { isMultiSport: () => true } as EventInterface;
    const emit = vi.spyOn(component.xAxisTypeChange, 'emit');

    await component.onXAxisTypeChange(XAxisTypes.Time);

    expect(emit).not.toHaveBeenCalled();
    expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
    expect(analyticsServiceMock.logEvent).not.toHaveBeenCalled();
  });

  it('ignores distance x-axis changes when distance is unavailable', async () => {
    component.canSelectDistanceXAxis = false;
    component.xAxisType = XAxisTypes.Duration;
    const xAxisTypeEmitSpy = vi.spyOn(component.xAxisTypeChange, 'emit');

    await component.onXAxisTypeChange(XAxisTypes.Distance);

    expect(component.xAxisType).toBe(XAxisTypes.Duration);
    expect(xAxisTypeEmitSpy).not.toHaveBeenCalled();
    expect(analyticsServiceMock.logEvent).not.toHaveBeenCalledWith('event_chart_settings_change', { property: 'xAxisType' });
  });

  it('should emit cursorBehaviour changes and log analytics', async () => {
    const emitSpy = vi.spyOn(component.cursorBehaviourChange, 'emit');

    await component.onCursorBehaviourChange(ChartCursorBehaviours.SelectX);

    expect(emitSpy).toHaveBeenCalledWith(ChartCursorBehaviours.SelectX);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'cursorBehaviour' });
  });

  it('should toggle cursorBehaviour between zoom and select', async () => {
    const emitSpy = vi.spyOn(component.cursorBehaviourChange, 'emit');

    component.cursorBehaviour = ChartCursorBehaviours.ZoomX;
    await component.onCursorBehaviourToggle();
    expect(emitSpy).toHaveBeenLastCalledWith(ChartCursorBehaviours.SelectX);

    await component.onCursorBehaviourToggle();
    expect(emitSpy).toHaveBeenLastCalledWith(ChartCursorBehaviours.ZoomX);
  });

  it('should emit showAllData changes and log analytics', async () => {
    const emitSpy = vi.spyOn(component.showAllDataChange, 'emit');

    await component.onShowAllDataToggle(true);

    expect(emitSpy).toHaveBeenCalledWith(true);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'showAllData' });
  });

  it('forces merged and benchmark metric availability without mutating showAllData', async () => {
    component.showAllData = false;
    component.allRecordedMetricsForced = true;
    const emitSpy = vi.spyOn(component.showAllDataChange, 'emit');

    expect(component.effectiveShowAllData).toBe(true);
    expect(component.includeAllRecordedMetricsTooltip).toContain('Merged and benchmark events');

    await component.onShowAllDataToggle(false);

    expect(component.showAllData).toBe(false);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should emit showLaps changes and log analytics', async () => {
    const emitSpy = vi.spyOn(component.showLapsChange, 'emit');

    await component.onShowLapsToggle(true);

    expect(emitSpy).toHaveBeenCalledWith(true);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'showLaps' });
  });

  it('should emit showSwimLengths changes and log analytics', async () => {
    const emitSpy = vi.spyOn(component.showSwimLengthsChange, 'emit');

    await component.onShowSwimLengthsToggle(true);

    expect(emitSpy).toHaveBeenCalledWith(true);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'showSwimLengths' });
  });

  it('should only render the swim length toggle when swim lengths are available', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/event/chart/actions/event.card.chart.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');

    expect(template).toContain('@if (showSwimLengthsToggle)');
    expect(template).toContain('Show Swim Lengths');
  });

  it('should emit fillOpacity changes and log analytics', async () => {
    const emitSpy = vi.spyOn(component.fillOpacityChange, 'emit');

    await component.onFillOpacityChange(0.45);

    expect(emitSpy).toHaveBeenCalledWith(0.45);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'fillOpacity' });
  });

  it('should emit syncChartHoverToMap changes and log analytics', async () => {
    const emitSpy = vi.spyOn(component.syncChartHoverToMapChange, 'emit');

    await component.onSyncChartHoverToMapToggle(true);

    expect(emitSpy).toHaveBeenCalledWith(true);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'syncChartHoverToMap' });
  });

  it('should emit colorAltitudeByGrade changes and log analytics', async () => {
    const emitSpy = vi.spyOn(component.colorAltitudeByGradeChange, 'emit');

    await component.onColorAltitudeByGradeToggle(false);

    expect(emitSpy).toHaveBeenCalledWith(false);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'colorAltitudeByGrade' });
  });

  it('should only render the altitude grade color toggle when grade-colored altitude is available', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/event/chart/actions/event.card.chart.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');

    expect(template).toContain('@if (showAltitudeGradeColorToggle)');
    expect(template).toContain('Color Altitude by Grade');
  });

  it('should emit series visibility toggle requests', () => {
    const emitSpy = vi.spyOn(component.seriesVisibilityToggle, 'emit');

    component.onSeriesVisibilityToggle('pace', false);

    expect(emitSpy).toHaveBeenCalledWith({ dataType: 'pace', visible: false });
  });

  it('should emit show all series requests', () => {
    const emitSpy = vi.spyOn(component.showAllSeries, 'emit');

    component.onShowAllSeries();

    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('should emit sport-default reset requests and log analytics', () => {
    const emitSpy = vi.spyOn(component.resetToSportDefaults, 'emit');

    component.onResetToSportDefaults();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith(
      'event_chart_settings_change',
      { property: 'resetToSportDefaults' },
    );
  });

  it('should emit reset chart state requests and log analytics', () => {
    const emitSpy = vi.spyOn(component.resetChartState, 'emit');

    component.onResetChartState();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'resetChartState' });
  });

  it('should expose a visible/total badge label for the series trigger', () => {
    component.seriesMenuItems = [
      { dataType: 'speed', label: 'Speed', color: '#111111', visible: true },
      { dataType: 'power', label: 'Power', color: '#222222', visible: false },
      { dataType: 'heart-rate', label: 'Heart Rate', color: '#333333', visible: true },
    ];

    expect(component.seriesBadgeLabel).toBe('2/3');
  });

  it('offers to show all charts for automatic visibility or hidden custom charts', () => {
    component.seriesMenuItems = [
      { dataType: 'power', label: 'Power', color: '#111111', visible: true },
      { dataType: 'temperature', label: 'Temperature', color: '#222222', visible: false },
    ];

    expect(component.shouldShowAllSeriesAction).toBe(true);

    component.seriesMenuItems = component.seriesMenuItems.map((item) => ({ ...item, visible: true }));

    expect(component.shouldShowAllSeriesAction).toBe(true);

    component.showResetToSportDefaults = true;

    expect(component.shouldShowAllSeriesAction).toBe(false);
  });
});
