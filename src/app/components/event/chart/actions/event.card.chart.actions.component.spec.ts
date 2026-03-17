import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { CommonModule } from '@angular/common';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChartCursorBehaviours, EventInterface, User, XAxisTypes } from '@sports-alliance/sports-lib';
import { vi } from 'vitest';
import { EventCardChartActionsComponent } from './event.card.chart.actions.component';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';
import { MenuRadioListComponent } from '../../../shared/menu-radio-list/menu-radio-list.component';
import { MatDividerModule } from '@angular/material/divider';

describe('EventCardChartActionsComponent', () => {
  let component: EventCardChartActionsComponent;
  let fixture: ComponentFixture<EventCardChartActionsComponent>;

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
        MatMenuModule,
        MatSliderModule,
        MatSlideToggleModule,
        MatTooltipModule,
      ],
      declarations: [EventCardChartActionsComponent, MenuRadioListComponent],
      providers: [
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
    component.syncChartHoverToMap = false;
    fixture.detectChanges();
    vi.clearAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should keep menu panel classes in template', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/event/chart/actions/event.card.chart.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');
    expect(template).toMatch(/<mat-menu[^>]*class="[^"]*qs-menu-panel[^"]*qs-menu-panel-form[^"]*qs-config-menu[^"]*"/);
  });

  it('should emit xAxisType changes and log analytics', async () => {
    const xAxisTypeEmitSpy = vi.spyOn(component.xAxisTypeChange, 'emit');

    await component.onXAxisTypeChange(XAxisTypes.Distance);

    expect(xAxisTypeEmitSpy).toHaveBeenCalledWith(XAxisTypes.Distance);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'xAxisType' });
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

  it('should emit showLaps changes and log analytics', async () => {
    const emitSpy = vi.spyOn(component.showLapsChange, 'emit');

    await component.onShowLapsToggle(true);

    expect(emitSpy).toHaveBeenCalledWith(true);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_chart_settings_change', { property: 'showLaps' });
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
});
