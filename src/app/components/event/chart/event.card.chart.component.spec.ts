import { BreakpointObserver } from '@angular/cdk/layout';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChartCursorBehaviours,
  DataDistance,
  DataStrydDistance,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import { EventCardChartComponent } from './event.card.chart.component';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppActivityCursorService } from '../../../services/activity-cursor/app-activity-cursor.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LoggerService } from '../../../services/logger.service';
import { AppChartSettingsLocalStorageService } from '../../../services/storage/app.chart.settings.local.storage.service';
import * as eventDataHelper from '../../../helpers/event-echarts-data.helper';
import { MaterialModule } from '../../../modules/material.module';

describe('EventCardChartComponent', () => {
  let fixture: ComponentFixture<EventCardChartComponent>;
  let component: EventCardChartComponent;

  const chartSettingsSignal = signal({
    showAllData: false,
    showLaps: true,
    syncChartHoverToMap: false,
    lapTypes: [],
    xAxisType: XAxisTypes.Duration,
    chartCursorBehaviour: ChartCursorBehaviours.ZoomX,
    gainAndLossThreshold: 1,
    fillOpacity: 0.4,
    useAnimations: false,
  } as any);

  const mockUserSettingsQuery = {
    chartSettings: chartSettingsSignal,
    unitSettings: signal({}),
    updateChartSettings: vi.fn().mockResolvedValue(undefined),
  };

  const mockUserService = {
    getUserChartDataTypesToUse: vi.fn().mockReturnValue(['power']),
  };

  const mockActivityCursorService = {
    setCursor: vi.fn(),
  };

  const mockEventColorService = {
    getActivityColor: vi.fn().mockReturnValue('#ff0000'),
  };

  const mockChartSettingsStorage = {
    getDataTypeIDsToShow: vi.fn().mockReturnValue([]),
    setDataTypeIDsToShow: vi.fn(),
  };

  const mockBreakpointObserver = {
    observe: vi.fn().mockReturnValue(of({ matches: false, breakpoints: {} })),
  };

  beforeEach(async () => {
    mockUserSettingsQuery.updateChartSettings.mockResolvedValue(undefined);
    mockActivityCursorService.setCursor.mockReset();
    mockChartSettingsStorage.getDataTypeIDsToShow.mockReturnValue([]);
    mockChartSettingsStorage.setDataTypeIDsToShow.mockReset();
    mockBreakpointObserver.observe.mockReset();
    mockBreakpointObserver.observe.mockReturnValue(of({ matches: false, breakpoints: {} }));

    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([]);
    vi.spyOn(eventDataHelper, 'buildEventLapMarkers').mockReturnValue([]);

    await TestBed.configureTestingModule({
      imports: [MaterialModule, NoopAnimationsModule],
      declarations: [EventCardChartComponent],
      providers: [
        { provide: BreakpointObserver, useValue: mockBreakpointObserver },
        { provide: AppUserSettingsQueryService, useValue: mockUserSettingsQuery },
        { provide: AppUserService, useValue: mockUserService },
        { provide: AppActivityCursorService, useValue: mockActivityCursorService },
        { provide: AppEventColorService, useValue: mockEventColorService },
        { provide: AppChartSettingsLocalStorageService, useValue: mockChartSettingsStorage },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(EventCardChartComponent);
    component = fixture.componentInstance;
    component.darkTheme = false;

    component.user = { uid: 'u1' } as any;
    component.targetUserID = 'u1';
    component.event = {
      isMultiSport: () => false,
      getActivities: () => [],
      getID: () => 'event-1',
    } as any;
    component.selectedActivities = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should create and rebuild chart panels', async () => {
    const buildPanelsSpy = vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      {
        dataType: 'power',
        displayName: 'Power',
        unit: 'W',
        colorGroupKey: 'Power',
        minX: 0,
        maxX: 1,
        series: [],
      },
    ] as any);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component).toBeTruthy();
    expect(buildPanelsSpy).toHaveBeenCalled();
    expect(component.chartPanels).toHaveLength(1);
    expect(component.dataTypeLegendItems).toHaveLength(1);
    expect(component.xDomain).toEqual({ start: 0, end: 1 });
  });

  it('shows activity names in tooltips for merge events', () => {
    component.event = {
      isMerge: true,
      getActivities: () => [],
      getID: () => 'event-1',
    } as any;

    expect(component.showActivityNamesInTooltip).toBe(true);
  });

  it('shows activity names in tooltips for benchmark events', () => {
    component.event = {
      isMerge: false,
      benchmarkResults: { test: {} },
      getActivities: () => [],
      getID: () => 'event-1',
    } as any;

    expect(component.showActivityNamesInTooltip).toBe(true);
  });

  it('hides activity names in tooltips for normal events', () => {
    component.event = {
      isMerge: false,
      getActivities: () => [],
      getID: () => 'event-1',
    } as any;

    expect(component.showActivityNamesInTooltip).toBe(false);
  });

  it('exposes the series menu summary from current legend visibility', async () => {
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      {
        dataType: 'pace',
        displayName: 'Pace',
        unit: 'min/km',
        colorGroupKey: 'Pace',
        minX: 0,
        maxX: 100,
        series: [],
      },
      {
        dataType: 'speed',
        displayName: 'Speed',
        unit: 'km/h',
        colorGroupKey: 'Speed',
        minX: 0,
        maxX: 100,
        series: [],
      },
    ] as any);
    mockChartSettingsStorage.getDataTypeIDsToShow.mockReturnValue(['pace']);

    component.user = { uid: 'u1' } as any;
    component.targetUserID = 'u1';
    component.event = {
      isMultiSport: () => false,
      getActivities: () => [],
      getID: () => 'event-1',
    } as any;
    component.selectedActivities = [];

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.seriesMenuSummary).toBe('Series 1/2');
  });

  it('should persist showAllData changes', async () => {
    fixture.detectChanges();

    component.showAllData = true;

    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({ showAllData: true });
  });

  it('should persist xAxisType changes', async () => {
    fixture.detectChanges();

    component.xAxisType = XAxisTypes.Distance;

    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({ xAxisType: XAxisTypes.Distance });
  });

  it('should persist cursorBehaviour changes and clear selection when returning to zoom mode', async () => {
    fixture.detectChanges();
    component.previewSelectedRange = { start: 10, end: 20 };
    component.selectedRange = { start: 10, end: 20 };

    component.cursorBehaviour = ChartCursorBehaviours.SelectX;
    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({ chartCursorBehaviour: ChartCursorBehaviours.SelectX });

    vi.clearAllMocks();
    component.previewSelectedRange = { start: 10, end: 20 };
    component.selectedRange = { start: 10, end: 20 };
    component.cursorBehaviour = ChartCursorBehaviours.ZoomX;

    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({ chartCursorBehaviour: ChartCursorBehaviours.ZoomX });
    expect(component.previewSelectedRange).toBeNull();
    expect(component.selectedRange).toBeNull();
  });

  it('should persist syncChartHoverToMap changes', async () => {
    fixture.detectChanges();

    component.syncChartHoverToMap = true;

    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({ syncChartHoverToMap: true });
  });

  it('debounces fill opacity persistence while exposing the local override immediately', async () => {
    vi.useFakeTimers();
    fixture.detectChanges();

    component.fillOpacity = 0.55;

    expect(component.fillOpacity).toBe(0.55);
    expect(mockUserSettingsQuery.updateChartSettings).not.toHaveBeenCalledWith({ fillOpacity: 0.55 });

    vi.advanceTimersByTime(180);
    await Promise.resolve();

    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({ fillOpacity: 0.55, fillOpacityVersion: 1 });
  });

  it('ignores legacy saved fill opacity until the new version marker exists', async () => {
    chartSettingsSignal.set({
      ...chartSettingsSignal(),
      fillOpacity: 0.6,
      fillOpacityVersion: undefined,
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.fillOpacity).toBe(0);
  });

  it('pushes cursor updates to map service for distance mode', async () => {
    chartSettingsSignal.set({
      ...chartSettingsSignal(),
      xAxisType: XAxisTypes.Distance,
    });

    const distanceStream = { getData: () => [0, 100, 200] };
    const timeStream = { getData: () => [0, 10, 20] };
    const activity = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      getID: () => 'a1',
      getStream: (type: string) => {
        if (type === DataDistance.type || type === DataStrydDistance.type) {
          return distanceStream;
        }
        if (type === XAxisTypes.Time) {
          return timeStream;
        }
        return null;
      },
    } as any;

    component.selectedActivities = [activity];
    component.event = {
      isMultiSport: () => false,
      getActivities: () => [activity],
    } as any;

    fixture.detectChanges();
    await fixture.whenStable();

    component.onPanelCursorPositionChange(120);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(mockActivityCursorService.setCursor).toHaveBeenCalledWith({
      activityID: 'a1',
      time: activity.startDate.getTime() + 10 * 1000,
      byChart: true,
    });
  });

  it('restores persisted datatype visibility when ids are valid', async () => {
    mockChartSettingsStorage.getDataTypeIDsToShow.mockReturnValue(['speed']);
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      {
        dataType: 'power',
        displayName: 'Power',
        unit: 'W',
        colorGroupKey: 'Power',
        minX: 0,
        maxX: 100,
        series: [],
      },
      {
        dataType: 'speed',
        displayName: 'Speed',
        unit: 'km/h',
        colorGroupKey: 'Speed',
        minX: 0,
        maxX: 100,
        series: [],
      },
    ] as any);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual(['speed']);
    expect(mockChartSettingsStorage.setDataTypeIDsToShow).toHaveBeenCalledWith(component.event, ['speed']);
  });

  it('falls back to showing all panels when persisted ids are stale', async () => {
    mockChartSettingsStorage.getDataTypeIDsToShow.mockReturnValue(['legacy-id']);
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      {
        dataType: 'power',
        displayName: 'Power',
        unit: 'W',
        colorGroupKey: 'Power',
        minX: 0,
        maxX: 100,
        series: [],
      },
      {
        dataType: 'speed',
        displayName: 'Speed',
        unit: 'km/h',
        colorGroupKey: 'Speed',
        minX: 0,
        maxX: 100,
        series: [],
      },
    ] as any);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual(['power', 'speed']);
  });

  it('updates visible panels and persists when datatype selection changes', async () => {
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      {
        dataType: 'power',
        displayName: 'Power',
        unit: 'W',
        colorGroupKey: 'Power',
        minX: 0,
        maxX: 100,
        series: [],
      },
      {
        dataType: 'speed',
        displayName: 'Speed',
        unit: 'km/h',
        colorGroupKey: 'Speed',
        minX: 0,
        maxX: 100,
        series: [],
      },
    ] as any);

    fixture.detectChanges();
    await fixture.whenStable();

    component.onDataTypeLegendSelectionChange('speed', false);

    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual(['power']);
    expect(mockChartSettingsStorage.setDataTypeIDsToShow).toHaveBeenCalledWith(component.event, ['power']);
  });

  it('skips panel rebuild when non-material settings change', async () => {
    const buildPanelsSpy = vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      {
        dataType: 'power',
        displayName: 'Power',
        unit: 'W',
        colorGroupKey: 'Power',
        minX: 0,
        maxX: 100,
        series: [],
      },
    ] as any);

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(buildPanelsSpy).toHaveBeenCalledTimes(1);

    chartSettingsSignal.set({
      ...chartSettingsSignal(),
      useAnimations: !chartSettingsSignal().useAnimations,
    } as any);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(buildPanelsSpy).toHaveBeenCalledTimes(1);
  });

  it('persists visible datatype ids only when the selection actually changes', async () => {
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      {
        dataType: 'power',
        displayName: 'Power',
        unit: 'W',
        colorGroupKey: 'Power',
        minX: 0,
        maxX: 100,
        series: [],
      },
    ] as any);

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const baselineWrites = mockChartSettingsStorage.setDataTypeIDsToShow.mock.calls.length;
    component.onDataTypeLegendSelectionChange('power', true);

    expect(mockChartSettingsStorage.setDataTypeIDsToShow.mock.calls.length).toBe(baselineWrites);
  });

  it('does not rebuild panels when datatype input order changes but enabled set stays the same', async () => {
    let preferredDataTypes = ['power', 'speed'];
    mockUserService.getUserChartDataTypesToUse.mockImplementation(() => [...preferredDataTypes]);

    const buildPanelsSpy = vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockImplementation((input: any) => {
      return (input.dataTypesToUse || []).map((dataType: string, index: number) => ({
        dataType,
        displayName: dataType,
        unit: '',
        colorGroupKey: dataType,
        minX: 0,
        maxX: index + 1,
        series: [
          {
            id: `${dataType}-series`,
            activityID: 'a1',
            activityName: 'Activity',
            color: '#ff0000',
            streamType: dataType,
            displayName: dataType,
            unit: '',
            points: [{ x: 0, y: 1, time: 0 }],
          }
        ],
      })) as any;
    });

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(buildPanelsSpy).toHaveBeenCalledTimes(1);
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual(['power', 'speed']);

    preferredDataTypes = ['speed', 'power'];
    (component as any).rebuildPanels('order-change');

    expect(buildPanelsSpy).toHaveBeenCalledTimes(1);
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual(['power', 'speed']);
  });

  it('normalizes full-domain zoom updates to null', () => {
    component.xDomain = { start: 0, end: 100 };

    component.onZoomRangeChange({ start: 0, end: 100 });

    expect(component.zoomRange).toBeNull();
  });

  it('stores clamped shared zoom range updates', () => {
    component.xDomain = { start: 0, end: 100 };

    component.onZoomRangeChange({ start: -10, end: 40 });

    expect(component.zoomRange).toEqual({ start: 0, end: 40 });
  });

  it('exposes active zoom state only when a non-null zoom range exists', () => {
    component.zoomRange = null;
    expect(component.hasActiveZoomRange).toBe(false);

    component.zoomRange = { start: 10, end: 50 };
    expect(component.hasActiveZoomRange).toBe(true);
  });

  it('clears active zoom range when reset is requested', () => {
    component.zoomRange = { start: 10, end: 50 };

    component.onResetZoomRequested();

    expect(component.zoomRange).toBeNull();
  });

  it('exposes branded watermark text when provided', () => {
    component.waterMark = 'Dimitrios';

    expect(component.hasWaterMark).toBe(true);
    expect(component.waterMarkText).toBe('Dimitrios');
  });

  it('treats blank watermark text as absent', () => {
    component.waterMark = '   ';

    expect(component.hasWaterMark).toBe(false);
    expect(component.waterMarkText).toBe('');
  });
});
