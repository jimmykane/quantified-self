import { BreakpointObserver } from '@angular/cdk/layout';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartCursorBehaviours,
  DataAltitude,
  DataCadence,
  DataDepth,
  DataDistance,
  DataHeartRate,
  DataPace,
  DataPower,
  DataSpeed,
  DataStrokeRate,
  DataSpeedKilometersPerHour,
  DataSpeedMilesPerHour,
  DataStrydDistance,
  DataSwimPace,
  DataTemperature,
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

  const defaultChartSettings = {
    showAllData: false,
    showLaps: true,
    showSwimLengths: true,
    syncChartHoverToMap: false,
    lapTypes: [],
    xAxisType: XAxisTypes.Duration,
    chartCursorBehaviour: ChartCursorBehaviours.ZoomX,
    gainAndLossThreshold: 1,
    fillOpacity: 0.4,
    useAnimations: false,
    eventChartOverlayDataTypeByPrimary: {},
  } as any;

  const chartSettingsSignal = signal({
    ...defaultChartSettings,
  } as any);

  const mockUserSettingsQuery = {
    chartSettings: chartSettingsSignal,
    unitSettings: signal({}),
    updateChartSettings: vi.fn().mockResolvedValue(undefined),
  };

  const mockUserService = {
    getUserChartDataTypesToUse: vi.fn().mockReturnValue([DataPower.type]),
  };

  const mockActivityCursorService = {
    setCursor: vi.fn(),
  };

  const mockEventColorService = {
    getActivityColor: vi.fn().mockReturnValue('#ff0000'),
  };

  const mockChartSettingsStorage = {
    getEventChartVisibilityPreference: vi.fn().mockReturnValue({
      mode: 'automatic',
      selectionKeys: [],
    }),
    setEventChartCustomVisibilityPreference: vi.fn(),
    resetEventChartVisibilityPreference: vi.fn(),
  };

  const mockLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
  };

  const mockBreakpointObserver = {
    observe: vi.fn().mockReturnValue(of({ matches: false, breakpoints: {} })),
  };

  beforeEach(async () => {
    chartSettingsSignal.set({
      ...defaultChartSettings,
    });
    mockUserSettingsQuery.updateChartSettings.mockResolvedValue(undefined);
    mockUserService.getUserChartDataTypesToUse.mockReset();
    mockUserService.getUserChartDataTypesToUse.mockReturnValue([DataPower.type]);
    mockActivityCursorService.setCursor.mockReset();
    mockChartSettingsStorage.getEventChartVisibilityPreference.mockReset();
    mockChartSettingsStorage.getEventChartVisibilityPreference.mockReturnValue({
      mode: 'automatic',
      selectionKeys: [],
    });
    mockChartSettingsStorage.setEventChartCustomVisibilityPreference.mockReset();
    mockChartSettingsStorage.resetEventChartVisibilityPreference.mockReset();
    mockLogger.error.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.info.mockReset();
    mockLogger.log.mockReset();
    mockBreakpointObserver.observe.mockReset();
    mockBreakpointObserver.observe.mockReturnValue(of({ matches: false, breakpoints: {} }));

    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([]);
    vi.spyOn(eventDataHelper, 'buildEventLapMarkers').mockReturnValue([]);
    vi.spyOn(eventDataHelper, 'buildEventSwimLengthMarkers').mockReturnValue([]);

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
        { provide: LoggerService, useValue: mockLogger },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(EventCardChartComponent);
    component = fixture.componentInstance;
    component.darkTheme = false;

    component.user = { uid: 'u1' } as any;
    component.targetUserID = 'u1';
    const defaultActivity = {
      type: ActivityTypes.Cycling,
      getID: () => 'activity-1',
    } as any;
    component.event = {
      isMultiSport: () => false,
      getActivities: () => [defaultActivity],
      getID: () => 'event-1',
    } as any;
    component.selectedActivities = [defaultActivity];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function flushOverlayPersistQueue(): Promise<void> {
    await ((component as any).eventChartOverlayPersistQueue as Promise<void>).catch(() => undefined);
  }

  async function flushCursorBehaviourPersistQueue(): Promise<void> {
    await ((component as any).cursorBehaviourPersistQueue as Promise<void>).catch(() => undefined);
  }

  async function flushMicrotasks(iterations = 4): Promise<void> {
    for (let index = 0; index < iterations; index += 1) {
      await Promise.resolve();
    }
  }

  it('should create and rebuild chart panels', async () => {
    const buildPanelsSpy = vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      {
        dataType: DataPower.type,
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
    expect(component.sportProfile.profileID).toBe('cycling');
    expect(component.allChartPanels.map((panel) => panel.dataType)).toEqual([DataPower.type]);
    expect((component as any).automaticDataTypeIDs).toEqual([DataPower.type]);
    expect(component.chartPanels).toHaveLength(1);
    expect(component.dataTypeLegendItems).toHaveLength(1);
    expect(component.xDomain).toEqual({ start: 0, end: 1 });
  });

  it('passes intensity-zone line coloring enabled for non-merged events', async () => {
    const buildPanelsSpy = vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([]);
    component.event = {
      isMerge: false,
      getActivities: () => [],
      getID: () => 'event-1',
    } as any;

    fixture.detectChanges();
    await fixture.whenStable();

    expect(buildPanelsSpy).toHaveBeenCalledWith(expect.objectContaining({
      colorIntensityZoneLines: true,
    }));
  });

  it('does not build swim length markers when selected activities have none', async () => {
    const buildSwimLengthMarkersSpy = vi.spyOn(eventDataHelper, 'buildEventSwimLengthMarkers').mockReturnValue([]);
    const activity = {
      getID: () => 'run-1',
      getSwimLengths: () => [],
    } as any;
    component.selectedActivities = [activity];
    component.event = {
      isMultiSport: () => false,
      getActivities: () => [activity],
      getID: () => 'event-1',
    } as any;

    fixture.detectChanges();
    await fixture.whenStable();
    await flushMicrotasks();

    expect(component.hasSelectedSwimLengths).toBe(false);
    expect(component.swimLengthMarkers).toEqual([]);
    expect(buildSwimLengthMarkersSpy).not.toHaveBeenCalled();
  });

  it('builds swim length markers when selected activities have swim lengths', async () => {
    const marker = {
      markerType: 'swimLength',
      xValue: 25,
      label: 'Length 1',
      color: '#00aaff',
      swimLengthIndex: 1,
      swimLengthType: 'active',
      isIdle: false,
      activityID: 'swim-1',
      activityName: 'Garmin',
      tooltipTitle: 'Length 1 (Active)',
      tooltipDetails: [],
    } as any;
    const buildSwimLengthMarkersSpy = vi.spyOn(eventDataHelper, 'buildEventSwimLengthMarkers').mockReturnValue([marker]);
    const activity = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      creator: { name: 'Garmin' },
      getID: () => 'swim-1',
      getSwimLengths: () => [
        {
          index: 1,
          startDate: new Date('2024-01-01T00:00:00.000Z'),
          endDate: new Date('2024-01-01T00:00:25.000Z'),
          type: 'active',
        },
      ],
    } as any;
    component.selectedActivities = [activity];
    component.event = {
      isMultiSport: () => false,
      getActivities: () => [activity],
      getID: () => 'event-1',
    } as any;

    fixture.detectChanges();
    await fixture.whenStable();
    await flushMicrotasks();

    expect(component.hasSelectedSwimLengths).toBe(true);
    expect(component.swimLengthMarkers).toEqual([marker]);
    expect(buildSwimLengthMarkersSpy).toHaveBeenCalledWith(expect.objectContaining({
      selectedActivities: [activity],
      allActivities: [activity],
      xAxisType: XAxisTypes.Duration,
    }));
  });

  it('passes intensity-zone line coloring disabled for merged events', async () => {
    const buildPanelsSpy = vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([]);
    component.event = {
      isMerge: true,
      getActivities: () => [],
      getID: () => 'event-1',
    } as any;

    fixture.detectChanges();
    await fixture.whenStable();

    expect(buildPanelsSpy).toHaveBeenCalledWith(expect.objectContaining({
      colorIntensityZoneLines: false,
    }));
  });

  it('rebuilds panels when intensity-zone coloring inputs change', async () => {
    const activity = {
      getID: () => 'a1',
      intensityZones: [
        {
          type: DataHeartRate.type,
          zone2LowerLimit: 120,
        },
        {
          type: DataPower.type,
          zone2LowerLimit: 180,
        }
      ],
    } as any;
    const buildPanelsSpy = vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      {
        dataType: 'heart-rate',
        displayName: 'Heart Rate',
        unit: 'bpm',
        colorGroupKey: 'Heart Rate',
        minX: 0,
        maxX: 100,
        series: [],
      },
    ] as any);

    component.selectedActivities = [activity];
    component.event = {
      isMerge: false,
      getActivities: () => [activity],
      getID: () => 'event-1',
    } as any;

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(buildPanelsSpy).toHaveBeenCalledTimes(1);

    activity.intensityZones[0].zone2LowerLimit = 125;
    (component as any).rebuildPanels('heart-rate-zone-boundary-change');

    expect(buildPanelsSpy).toHaveBeenCalledTimes(2);

    activity.intensityZones[1].zone2LowerLimit = 185;
    (component as any).rebuildPanels('power-zone-boundary-change');

    expect(buildPanelsSpy).toHaveBeenCalledTimes(3);

    component.event = {
      isMerge: true,
      getActivities: () => [activity],
      getID: () => 'event-1',
    } as any;
    (component as any).rebuildPanels('merge-flag-change');

    expect(buildPanelsSpy).toHaveBeenCalledTimes(4);
  });

  it('shows activity names in tooltips for merge events', () => {
    component.event = {
      isMerge: true,
      getActivities: () => [],
      getID: () => 'event-1',
    } as any;

    expect(component.showActivityNamesInTooltip).toBe(true);
  });

  it('uses the existing merge-or-benchmark visibility flag for legend-capable events', () => {
    component.event = {
      isMerge: true,
      getActivities: () => [],
      getID: () => 'event-1',
    } as any;

    expect(component.showActivityNamesInTooltip).toBe(true);

    component.event = {
      isMerge: false,
      hasBenchmark: true,
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
    mockChartSettingsStorage.getEventChartVisibilityPreference.mockReturnValue({
      mode: 'custom',
      selectionKeys: ['pace'],
    });

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

    expect(component.seriesMenuSummary).toBe('Visible charts: 1/2');
  });

  it('should persist showAllData changes', async () => {
    fixture.detectChanges();

    component.showAllData = true;

    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({ showAllData: true });
  });

  it('should persist showSwimLengths changes independently of showLaps', async () => {
    fixture.detectChanges();

    component.showSwimLengths = false;

    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({ showSwimLengths: false });
    expect(mockUserSettingsQuery.updateChartSettings).not.toHaveBeenCalledWith({ showLaps: false });
  });

  it('should persist xAxisType changes', async () => {
    fixture.detectChanges();

    component.xAxisType = XAxisTypes.Distance;

    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({ xAxisType: XAxisTypes.Distance });
  });

  it('falls back to duration axis when a selected diving activity has heart rate but no distance stream', async () => {
    chartSettingsSignal.set({
      ...chartSettingsSignal(),
      xAxisType: XAxisTypes.Distance,
    });

    const heartRateStream = { type: DataHeartRate.type, getData: () => [88, 82, 77, 72] };
    const timeStream = { type: XAxisTypes.Time, getData: () => [0, 1, 2, 3] };
    const activity = {
      type: ActivityTypes.Diving,
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      getID: () => 'dive-a1',
      getAllStreams: () => [heartRateStream, timeStream],
      getStream: (type: string) => {
        if (type === DataHeartRate.type) {
          return heartRateStream;
        }
        if (type === XAxisTypes.Time) {
          return timeStream;
        }
        return null;
      },
    } as any;

    const buildPanelsSpy = vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      {
        dataType: DataHeartRate.type,
        displayName: 'Heart Rate',
        unit: 'bpm',
        colorGroupKey: DataHeartRate.type,
        minX: 0,
        maxX: 3,
        series: [],
      },
    ] as any);

    component.selectedActivities = [activity];
    component.event = {
      isMultiSport: () => false,
      getActivities: () => [activity],
      getID: () => 'event-1',
    } as any;

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.renderedXAxisType).toBe(XAxisTypes.Duration);
    expect(component.displayedXAxisType).toBe(XAxisTypes.Duration);
    expect(component.canSelectDistanceXAxis).toBe(false);
    expect(buildPanelsSpy).toHaveBeenCalledWith(expect.objectContaining({ xAxisType: XAxisTypes.Duration }));
  });

  it('keeps distance axis selectable when selected indoor activity has finite distance stream data', async () => {
    chartSettingsSignal.set({
      ...chartSettingsSignal(),
      xAxisType: XAxisTypes.Distance,
    });

    const speedStream = { type: DataSpeed.type, getData: () => [3, 4, 5] };
    const timeStream = { type: XAxisTypes.Time, getData: () => [0, 10, 20] };
    const distanceStream = { type: DataDistance.type, getData: () => [0, 25, 50] };
    const activity = {
      type: ActivityTypes.IndoorCycling,
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      getID: () => 'indoor-a1',
      getAllStreams: () => [speedStream, timeStream, distanceStream],
      getStream: (type: string) => {
        if (type === DataSpeed.type) {
          return speedStream;
        }
        if (type === XAxisTypes.Time) {
          return timeStream;
        }
        if (type === DataDistance.type) {
          return distanceStream;
        }
        return null;
      },
    } as any;

    component.selectedActivities = [activity];
    component.event = {
      isMultiSport: () => false,
      getActivities: () => [activity],
      getID: () => 'event-1',
    } as any;

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.canSelectDistanceXAxis).toBe(true);
    expect(component.displayedXAxisType).toBe(XAxisTypes.Distance);
  });

  it('should persist cursorBehaviour changes and keep selection when returning to zoom mode', async () => {
    fixture.detectChanges();
    component.previewSelectedRange = { start: 10, end: 20 };
    component.selectedRange = { start: 10, end: 20 };

    component.cursorBehaviour = ChartCursorBehaviours.SelectX;
    await flushCursorBehaviourPersistQueue();
    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({ chartCursorBehaviour: ChartCursorBehaviours.SelectX });

    vi.clearAllMocks();
    component.previewSelectedRange = { start: 10, end: 20 };
    component.selectedRange = { start: 10, end: 20 };
    component.cursorBehaviour = ChartCursorBehaviours.ZoomX;
    await flushCursorBehaviourPersistQueue();

    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({ chartCursorBehaviour: ChartCursorBehaviours.ZoomX });
    expect(component.previewSelectedRange).toEqual({ start: 10, end: 20 });
    expect(component.selectedRange).toEqual({ start: 10, end: 20 });
  });

  it('keeps the optimistic cursor mode until matching settings confirm the completed write', async () => {
    let resolvePersist: (() => void) | null = null;
    mockUserSettingsQuery.updateChartSettings.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolvePersist = resolve;
    }));
    fixture.detectChanges();

    component.cursorBehaviour = ChartCursorBehaviours.SelectX;
    await flushMicrotasks();

    expect(component.cursorBehaviour).toBe(ChartCursorBehaviours.SelectX);

    resolvePersist?.();
    await flushCursorBehaviourPersistQueue();

    expect(component.cursorBehaviour).toBe(ChartCursorBehaviours.SelectX);
    expect((component as any).cursorBehaviourOverride).toBe(ChartCursorBehaviours.SelectX);

    chartSettingsSignal.set({
      ...chartSettingsSignal(),
      chartCursorBehaviour: ChartCursorBehaviours.SelectX,
    });
    TestBed.flushEffects();

    expect(component.cursorBehaviour).toBe(ChartCursorBehaviours.SelectX);
    expect((component as any).cursorBehaviourOverride).toBeNull();
  });

  it('serializes rapid cursor mode changes so the latest button state wins', async () => {
    const writeOrder: ChartCursorBehaviours[] = [];
    let resolveFirst: (() => void) | null = null;
    mockUserSettingsQuery.updateChartSettings
      .mockImplementationOnce((settings: any) => {
        writeOrder.push(settings.chartCursorBehaviour);
        return new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      })
      .mockImplementationOnce((settings: any) => {
        writeOrder.push(settings.chartCursorBehaviour);
        return Promise.resolve();
      });
    fixture.detectChanges();

    component.cursorBehaviour = ChartCursorBehaviours.SelectX;
    component.cursorBehaviour = ChartCursorBehaviours.ZoomX;
    await flushMicrotasks();

    expect(writeOrder).toEqual([ChartCursorBehaviours.SelectX]);
    expect(component.cursorBehaviour).toBe(ChartCursorBehaviours.ZoomX);

    resolveFirst?.();
    await flushCursorBehaviourPersistQueue();

    expect(writeOrder).toEqual([
      ChartCursorBehaviours.SelectX,
      ChartCursorBehaviours.ZoomX,
    ]);
    expect(component.cursorBehaviour).toBe(ChartCursorBehaviours.ZoomX);
  });

  it('reverts the optimistic cursor mode when the latest settings write fails', async () => {
    const error = new Error('write failed');
    mockUserSettingsQuery.updateChartSettings.mockRejectedValueOnce(error);
    fixture.detectChanges();

    component.cursorBehaviour = ChartCursorBehaviours.SelectX;
    expect(component.cursorBehaviour).toBe(ChartCursorBehaviours.SelectX);

    await flushCursorBehaviourPersistQueue();

    expect(component.cursorBehaviour).toBe(ChartCursorBehaviours.ZoomX);
    expect(mockLogger.error).toHaveBeenCalledWith(
      '[EventCardChart] Failed to persist chartCursorBehaviour setting',
      error,
    );
  });

  it('should persist syncChartHoverToMap changes', async () => {
    fixture.detectChanges();

    component.syncChartHoverToMap = true;

    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({ syncChartHoverToMap: true });
  });

  it('defaults altitude grade coloring on and persists toggle changes', async () => {
    fixture.detectChanges();

    expect(component.colorAltitudeByGrade).toBe(true);

    component.colorAltitudeByGrade = false;

    expect(component.colorAltitudeByGrade).toBe(false);
    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({ colorAltitudeByGrade: false });
  });

  it('exposes altitude grade color availability from loaded panel series', () => {
    component.allChartPanels = [
      {
        dataType: DataAltitude.type,
        displayName: 'Altitude',
        unit: 'm',
        colorGroupKey: 'Altitude',
        minX: 0,
        maxX: 10,
        series: [
          {
            id: 'a1::Altitude',
            activityID: 'a1',
            activityName: 'Activity',
            color: '#00aa00',
            streamType: DataAltitude.type,
            displayName: 'Altitude',
            unit: 'm',
            points: [{ x: 0, y: 100, time: 0 }],
            gradeColorValues: new Float64Array([4]),
            gradeColorSourceType: 'Grade Smooth',
          }
        ],
      }
    ] as any;

    expect(component.hasAltitudeGradeColorData).toBe(true);
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

  it('falls back to Stryd distance when Distance lookup throws while syncing cursor to map', async () => {
    chartSettingsSignal.set({
      ...chartSettingsSignal(),
      xAxisType: XAxisTypes.Distance,
    });

    const strydDistanceStream = { type: DataStrydDistance.type, getData: () => [0, 100, 200] };
    const timeStream = { type: XAxisTypes.Time, getData: () => [0, 10, 20] };
    const getStream = vi.fn((type: string) => {
      if (type === DataDistance.type) {
        throw new Error(`No stream found with type ${DataDistance.type}`);
      }
      if (type === DataStrydDistance.type) {
        return strydDistanceStream;
      }
      if (type === XAxisTypes.Time) {
        return timeStream;
      }
      return null;
    });
    const activity = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      getID: () => 'a1',
      getAllStreams: () => [strydDistanceStream, timeStream],
      getStream,
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

    expect(getStream).toHaveBeenCalledWith(DataDistance.type);
    expect(getStream).toHaveBeenCalledWith(DataStrydDistance.type);
    expect(mockActivityCursorService.setCursor).toHaveBeenCalledWith({
      activityID: 'a1',
      time: activity.startDate.getTime() + 10 * 1000,
      byChart: true,
    });
  });

  it('restores persisted datatype visibility when ids are valid', async () => {
    mockChartSettingsStorage.getEventChartVisibilityPreference.mockReturnValue({
      mode: 'custom',
      selectionKeys: [DataSpeed.type],
    });
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      {
        dataType: DataPower.type,
        displayName: 'Power',
        unit: 'W',
        colorGroupKey: 'Power',
        minX: 0,
        maxX: 100,
        series: [],
      },
      {
        dataType: DataSpeed.type,
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

    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([DataSpeed.type]);
    expect(mockChartSettingsStorage.setEventChartCustomVisibilityPreference).not.toHaveBeenCalled();
  });

  it('preserves custom visibility while its selected metric is unavailable', async () => {
    mockChartSettingsStorage.getEventChartVisibilityPreference.mockReturnValue({
      mode: 'custom',
      selectionKeys: [DataTemperature.type],
    });
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockImplementation((input) => (
      input.showAllData
        ? [chartPanel(DataTemperature.type)]
        : []
    ) as any);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.visibilityMode).toBe('custom');
    expect(component.chartPanels).toEqual([]);

    chartSettingsSignal.set({...chartSettingsSignal(), showAllData: true});
    fixture.detectChanges();
    await fixture.whenStable();
    await flushMicrotasks();

    expect(component.visibilityMode).toBe('custom');
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([DataTemperature.type]);
  });

  it('lists extra recorded metrics without showing them by default', async () => {
    chartSettingsSignal.set({
      ...chartSettingsSignal(),
      showAllData: true,
    });
    mockUserService.getUserChartDataTypesToUse.mockReturnValue([DataPower.type]);
    const panels = [
      {
        dataType: DataPower.type,
        displayName: 'Power',
        unit: 'W',
        colorGroupKey: 'Power',
        minX: 0,
        maxX: 100,
        series: [],
      },
      {
        dataType: 'Temperature',
        displayName: 'Temperature',
        unit: '°C',
        colorGroupKey: 'Temperature',
        minX: 0,
        maxX: 100,
        series: [],
      },
    ] as any;
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue(panels);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([DataPower.type]);
    expect(component.dataTypeLegendItems).toEqual([
      expect.objectContaining({ dataType: DataPower.type, visible: true }),
      expect.objectContaining({ dataType: 'Temperature', visible: false }),
    ]);
  });

  it('orders a first-view Running stack by sport and caps it at three eligible charts', async () => {
    chartSettingsSignal.set({...chartSettingsSignal(), showAllData: true});
    mockUserService.getUserChartDataTypesToUse.mockReturnValue([
      DataHeartRate.type,
      DataPace.type,
      DataPower.type,
      DataAltitude.type,
    ]);
    const runningActivity = {type: ActivityTypes.Running, getID: () => 'run-1'} as any;
    component.selectedActivities = [runningActivity];
    component.event = {
      getID: () => 'event-running',
      getActivities: () => [runningActivity],
      isMultiSport: () => false,
    } as any;
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      chartPanel(DataTemperature.type),
      chartPanel(DataAltitude.type),
      chartPanel(DataPower.type),
      chartPanel(DataPace.type),
      chartPanel(DataHeartRate.type),
    ] as any);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.visibilityMode).toBe('automatic');
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([
      DataHeartRate.type,
      DataPace.type,
      DataPower.type,
    ]);
    expect(component.recommendedDataTypeLegendItems.map((item) => item.dataType)).toEqual([
      DataHeartRate.type,
      DataPace.type,
      DataPower.type,
      DataAltitude.type,
      DataTemperature.type,
    ]);
    expect(mockChartSettingsStorage.setEventChartCustomVisibilityPreference).not.toHaveBeenCalled();
  });

  it('treats the global Pace preference as Swim Pace for swimming defaults', async () => {
    mockUserService.getUserChartDataTypesToUse.mockReturnValue([
      DataHeartRate.type,
      DataPace.type,
    ]);
    const swimmingActivity = {type: ActivityTypes.Swimming, getID: () => 'swim-1'} as any;
    component.selectedActivities = [swimmingActivity];
    component.event = {
      getID: () => 'event-swimming',
      getActivities: () => [swimmingActivity],
      isMultiSport: () => false,
    } as any;
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      chartPanel(DataSwimPace.type),
      chartPanel(DataHeartRate.type),
    ] as any);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.sportProfile.profileID).toBe('pool-swimming');
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([
      DataHeartRate.type,
      DataSwimPace.type,
    ]);
  });

  it('selects recorded Stroke Rate automatically for open-water swimming', async () => {
    mockUserService.getUserChartDataTypesToUse.mockReturnValue([
      DataHeartRate.type,
      DataSwimPace.type,
      DataStrokeRate.type,
    ]);
    const swimmingActivity = {type: ActivityTypes.OpenWaterSwimming, getID: () => 'swim-1'} as any;
    component.selectedActivities = [swimmingActivity];
    component.event = {
      getID: () => 'event-open-water-swimming',
      getActivities: () => [swimmingActivity],
      isMultiSport: () => false,
    } as any;
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      chartPanel(DataStrokeRate.type),
      chartPanel(DataSwimPace.type),
      chartPanel(DataHeartRate.type),
    ] as any);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.sportProfile.profileID).toBe('open-water-swimming');
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([
      DataHeartRate.type,
      DataSwimPace.type,
      DataStrokeRate.type,
    ]);
  });

  it('switches automatic defaults when the selected sport signature changes', async () => {
    mockUserService.getUserChartDataTypesToUse.mockReturnValue([
      DataHeartRate.type,
      DataPace.type,
      DataPower.type,
      DataCadence.type,
    ]);
    let selectedActivity = {type: ActivityTypes.Running, getID: () => 'run-1'} as any;
    component.selectedActivities = [selectedActivity];
    component.event = {
      getID: () => 'event-sport-switch',
      getActivities: () => [selectedActivity],
      isMultiSport: () => false,
    } as any;
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      chartPanel(DataCadence.type),
      chartPanel(DataPower.type),
      chartPanel(DataPace.type),
      chartPanel(DataHeartRate.type),
    ] as any);

    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([
      DataHeartRate.type,
      DataPace.type,
      DataPower.type,
    ]);

    selectedActivity = {type: ActivityTypes.IndoorCycling, getID: () => 'bike-1'} as any;
    component.selectedActivities = [selectedActivity];
    component.ngOnChanges({selectedActivities: {} as any});
    await fixture.whenStable();

    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([
      DataHeartRate.type,
      DataPower.type,
      DataCadence.type,
    ]);
  });

  it('resets only custom visibility for the current sport signature', async () => {
    mockUserService.getUserChartDataTypesToUse.mockReturnValue([DataPower.type]);
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      chartPanel(DataPower.type),
      chartPanel(DataSpeed.type),
    ] as any);

    fixture.detectChanges();
    await fixture.whenStable();
    component.onDataTypeLegendSelectionChange(DataSpeed.type, true);
    expect(component.visibilityMode).toBe('custom');
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([DataPower.type, DataSpeed.type]);

    component.onResetToSportDefaults();

    expect(mockChartSettingsStorage.resetEventChartVisibilityPreference).toHaveBeenCalledWith(
      component.event,
      component.sportProfile.signature,
    );
    expect(component.visibilityMode).toBe('automatic');
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([DataPower.type]);
    expect(component.visibilityAnnouncement()).toContain('Reset to Cycling defaults');
  });

  it('preserves an intentionally empty custom visibility selection', async () => {
    mockChartSettingsStorage.getEventChartVisibilityPreference.mockReturnValue({
      mode: 'custom',
      selectionKeys: [],
    });
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([chartPanel(DataPower.type)] as any);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.visibilityMode).toBe('custom');
    expect(component.chartPanels).toEqual([]);
    expect(component.dataTypeLegendItems).toEqual([
      expect.objectContaining({dataType: DataPower.type, visible: false}),
    ]);
  });

  it('preserves custom visibility when unit changes replace the rendered data type', async () => {
    mockChartSettingsStorage.getEventChartVisibilityPreference.mockReturnValue({
      mode: 'custom',
      selectionKeys: [DataSpeed.type],
    });
    const buildPanelsSpy = vi.spyOn(eventDataHelper, 'buildEventChartPanels')
      .mockReturnValueOnce([chartPanel(DataSpeedKilometersPerHour.type)] as any)
      .mockReturnValue([chartPanel(DataSpeedMilesPerHour.type)] as any);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.visibilityMode).toBe('custom');
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([
      DataSpeedKilometersPerHour.type,
    ]);

    mockUserSettingsQuery.unitSettings.set({speed: 'mph'} as any);
    fixture.detectChanges();
    await fixture.whenStable();
    await flushMicrotasks();

    expect(buildPanelsSpy).toHaveBeenCalledTimes(2);
    expect(component.visibilityMode).toBe('custom');
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([
      DataSpeedMilesPerHour.type,
    ]);
  });

  it('makes every recorded chart selectable for benchmarks without changing the global setting', async () => {
    const buildPanelsSpy = vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      chartPanel(DataPower.type),
      chartPanel(DataTemperature.type),
    ] as any);
    component.event = {
      hasBenchmark: true,
      getID: () => 'event-benchmark',
      getActivities: () => component.selectedActivities,
      isMultiSport: () => false,
    } as any;

    fixture.detectChanges();
    await fixture.whenStable();

    expect(buildPanelsSpy).toHaveBeenCalledWith(expect.objectContaining({showAllData: true}));
    expect(component.allRecordedMetricsForced).toBe(true);
    expect(component.dataTypeLegendItems.map((item) => item.dataType)).toEqual([
      DataPower.type,
      DataTemperature.type,
    ]);
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([DataPower.type]);

    component.onShowAllDataTypes();
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([
      DataPower.type,
      DataTemperature.type,
    ]);
    expect(mockUserSettingsQuery.updateChartSettings).not.toHaveBeenCalledWith({showAllData: true});
  });

  it('makes every recorded chart selectable for a merge-only event', async () => {
    const buildPanelsSpy = vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      chartPanel(DataPower.type),
    ] as any);
    component.event = {
      isMerge: true,
      getID: () => 'event-merge',
      getActivities: () => component.selectedActivities,
      isMultiSport: () => false,
    } as any;

    fixture.detectChanges();
    await fixture.whenStable();

    expect(buildPanelsSpy).toHaveBeenCalledWith(expect.objectContaining({showAllData: true}));
    expect(component.allRecordedMetricsForced).toBe(true);
  });

  it('keeps pinned dive-profile metrics selectable but excludes them from the automatic stack', async () => {
    const depthPanel = {
      dataType: DataDepth.type,
      displayName: 'Depth',
      unit: 'm',
      colorGroupKey: DataDepth.type,
      minX: 0,
      maxX: 20,
      series: [],
    };
    const heartRatePanel = {
      dataType: DataHeartRate.type,
      displayName: 'Heart Rate',
      unit: 'bpm',
      colorGroupKey: DataHeartRate.type,
      minX: 0,
      maxX: 20,
      series: [],
    };
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      depthPanel,
      heartRatePanel,
    ] as any);

    mockUserService.getUserChartDataTypesToUse.mockReturnValue([DataDepth.type, DataHeartRate.type]);
    component.automaticExcludedDataTypes = [DataDepth.type, DataHeartRate.type];
    component.selectedActivities = [{ type: ActivityTypes.Diving, getID: () => 'dive-1' } as any];
    component.event = {
      getID: () => 'event-1',
      getActivities: () => component.selectedActivities,
      isMultiSport: () => false,
    } as any;

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.allChartPanels.map((panel) => panel.dataType)).toEqual([DataDepth.type, DataHeartRate.type]);
    expect(component.chartPanels).toEqual([]);
    expect(component.dataTypeLegendItems.map((item) => item.dataType)).toEqual([DataDepth.type, DataHeartRate.type]);
  });

  it('updates visible panels and persists when datatype selection changes', async () => {
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      {
        dataType: DataPower.type,
        displayName: 'Power',
        unit: 'W',
        colorGroupKey: 'Power',
        minX: 0,
        maxX: 100,
        series: [],
      },
      {
        dataType: DataSpeed.type,
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

    component.onDataTypeLegendSelectionChange(DataSpeed.type, true);

    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([DataPower.type, DataSpeed.type]);
    expect(mockChartSettingsStorage.setEventChartCustomVisibilityPreference).toHaveBeenCalledWith(
      component.event,
      expect.stringContaining('Cycling'),
      [DataPower.type, DataSpeed.type],
    );
  });

  it('builds panel overlay views from all available metrics including hidden panels', async () => {
    chartSettingsSignal.set({
      ...chartSettingsSignal(),
      eventChartOverlayDataTypeByPrimary: {
        power: 'speed',
      },
    });
    mockChartSettingsStorage.getEventChartVisibilityPreference.mockReturnValue({
      mode: 'custom',
      selectionKeys: ['power'],
    });
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
      {
        dataType: 'heart-rate',
        displayName: 'Heart Rate',
        unit: 'bpm',
        colorGroupKey: 'Heart Rate',
        minX: 0,
        maxX: 100,
        series: [],
      },
    ] as any);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual(['power']);
    expect(component.chartPanelViews).toHaveLength(1);
    expect(component.chartPanelViews[0].overlayOptions.map((option) => option.dataType)).toEqual(['speed', 'heart-rate']);
    expect(component.chartPanelViews[0].selectedOverlayDataType).toBe('speed');
    expect(component.chartPanelViews[0].overlayPanel?.dataType).toBe('speed');
  });

  it('ignores unavailable saved overlays without deleting the global setting', async () => {
    chartSettingsSignal.set({
      ...chartSettingsSignal(),
      eventChartOverlayDataTypeByPrimary: {
        [DataPower.type]: DataAltitude.type,
      },
    });
    vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      {
        dataType: DataPower.type,
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

    expect(component.chartPanelViews[0].overlayPanel).toBeNull();
    expect(component.chartPanelViews[0].selectedOverlayDataType).toBeNull();
    expect(mockUserSettingsQuery.updateChartSettings).not.toHaveBeenCalledWith(expect.objectContaining({
      eventChartOverlayDataTypeByPrimary: expect.anything(),
    }));
  });

  it('persists directional overlay choices and preserves other primary mappings', async () => {
    chartSettingsSignal.set({
      ...chartSettingsSignal(),
      eventChartOverlayDataTypeByPrimary: {
        speed: 'power',
      },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    component.onPanelOverlayDataTypeChange('power', 'speed');
    await flushOverlayPersistQueue();

    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({
      eventChartOverlayDataTypeByPrimary: {
        speed: 'power',
        power: 'speed',
      },
    });
    expect((component as any).eventChartOverlayDataTypeByPrimaryOverride).toEqual({
      speed: 'power',
      power: 'speed',
    });
  });

  it('removes one directional overlay mapping when No overlay is selected', async () => {
    chartSettingsSignal.set({
      ...chartSettingsSignal(),
      eventChartOverlayDataTypeByPrimary: {
        power: 'speed',
        speed: 'power',
      },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    component.onPanelOverlayDataTypeChange('power', null);
    await flushOverlayPersistQueue();

    expect(mockUserSettingsQuery.updateChartSettings).toHaveBeenCalledWith({
      eventChartOverlayDataTypeByPrimary: {
        speed: 'power',
      },
    });
  });

  it('keeps the latest optimistic overlay choice when an older persist request fails later', async () => {
    const firstError = new Error('first failed');
    let rejectFirst: ((error: Error) => void) | null = null;
    mockUserSettingsQuery.updateChartSettings
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectFirst = reject;
      }))
      .mockResolvedValueOnce(undefined);

    fixture.detectChanges();
    await fixture.whenStable();

    component.onPanelOverlayDataTypeChange('power', 'speed');
    component.onPanelOverlayDataTypeChange('power', 'heart-rate');
    await flushMicrotasks();
    rejectFirst?.(firstError);
    await flushOverlayPersistQueue();

    expect((component as any).eventChartOverlayDataTypeByPrimaryOverride).toEqual({
      power: 'heart-rate',
    });
    expect(mockLogger.error).toHaveBeenCalledWith('[EventCardChart] Failed to persist event chart overlay setting', firstError);
  });

  it('serializes overlay persistence so rapid changes are written in user order', async () => {
    const writeOrder: Array<Record<string, string>> = [];
    let resolveFirst: (() => void) | null = null;
    mockUserSettingsQuery.updateChartSettings
      .mockImplementationOnce((settings: any) => {
        writeOrder.push(settings.eventChartOverlayDataTypeByPrimary);
        return new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      })
      .mockImplementationOnce((settings: any) => {
        writeOrder.push(settings.eventChartOverlayDataTypeByPrimary);
        return Promise.resolve();
      });

    fixture.detectChanges();
    await fixture.whenStable();

    component.onPanelOverlayDataTypeChange('power', 'speed');
    component.onPanelOverlayDataTypeChange('power', 'heart-rate');
    await flushMicrotasks();

    expect(writeOrder).toHaveLength(1);
    expect(writeOrder[0]).toEqual({ power: 'speed' });

    resolveFirst?.();
    await flushOverlayPersistQueue();

    expect(writeOrder).toHaveLength(2);
    expect(writeOrder[1]).toEqual({ power: 'heart-rate' });
  });

  it('skips panel rebuild when non-material settings change', async () => {
    const buildPanelsSpy = vi.spyOn(eventDataHelper, 'buildEventChartPanels').mockReturnValue([
      {
        dataType: DataPower.type,
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
        dataType: DataPower.type,
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

    const baselineWrites = mockChartSettingsStorage.setEventChartCustomVisibilityPreference.mock.calls.length;
    component.onDataTypeLegendSelectionChange(DataPower.type, true);

    expect(mockChartSettingsStorage.setEventChartCustomVisibilityPreference.mock.calls.length).toBe(baselineWrites);
  });

  it('does not rebuild panels when datatype input order changes but enabled set stays the same', async () => {
    let preferredDataTypes = [DataPower.type, DataSpeed.type];
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
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([DataPower.type, DataSpeed.type]);

    preferredDataTypes = [DataSpeed.type, DataPower.type];
    (component as any).rebuildPanels('order-change');

    expect(buildPanelsSpy).toHaveBeenCalledTimes(1);
    expect(component.chartPanels.map((panel) => panel.dataType)).toEqual([DataPower.type, DataSpeed.type]);
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

  it('exposes resettable chart state for either zoom or selection', () => {
    component.zoomRange = null;
    component.previewSelectedRange = null;
    component.selectedRange = null;
    expect(component.hasResettableChartState).toBe(false);

    component.selectedRange = { start: 15, end: 30 };
    expect(component.hasActiveSelectionRange).toBe(true);
    expect(component.hasResettableChartState).toBe(true);
  });

  it('clears active zoom and selected range when reset is requested', () => {
    component.zoomRange = { start: 10, end: 50 };
    component.previewSelectedRange = { start: 20, end: 40 };
    component.selectedRange = { start: 20, end: 40 };

    component.onResetChartStateRequested();

    expect(component.zoomRange).toBeNull();
    expect(component.previewSelectedRange).toBeNull();
    expect(component.selectedRange).toBeNull();
  });

  it('passes contextual reset state to each data chart panel', () => {
    const template = readFileSync(
      resolve(process.cwd(), 'src/app/components/event/chart/event.card.chart.component.html'),
      'utf8'
    );

    expect(template).toContain('[showResetChartState]="hasResettableChartState"');
    expect(template).toContain('(resetChartState)="onResetChartStateRequested()"');
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

  function chartPanel(dataType: string) {
    return {
      dataType,
      displayName: dataType,
      unit: '',
      colorGroupKey: dataType,
      minX: 0,
      maxX: 100,
      series: [],
    };
  }
});
