import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataAscent,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { AppThemeService } from '../../services/app.theme.service';
import { LoggerService } from '../../services/logger.service';
import * as dashboardTileViewModelHelper from '../../helpers/dashboard-tile-view-model.helper';
import { SummariesComponent } from './summaries.component';

describe('SummariesComponent', () => {
  let component: SummariesComponent;
  let fixture: ComponentFixture<SummariesComponent>;
  let mockThemeService: { getAppTheme: ReturnType<typeof vi.fn> };
  let mockLogger: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> };
  let buildDashboardTileViewModelsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockThemeService = {
      getAppTheme: vi.fn().mockReturnValue(of('light')),
    };
    mockLogger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
    buildDashboardTileViewModelsSpy = vi.spyOn(dashboardTileViewModelHelper, 'buildDashboardTileViewModels');

    await TestBed.configureTestingModule({
      declarations: [SummariesComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: AppThemeService, useValue: mockThemeService },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SummariesComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should delegate tile building with dashboard tiles, events, preferences, and logger on input changes', async () => {
    const builtTiles = [{
      type: TileTypes.Chart,
      order: 0,
      chartType: ChartTypes.ColumnsVertical,
      dataCategoryType: ChartDataCategoryTypes.ActivityType,
      dataValueType: ChartDataValueTypes.Total,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    }] as any[];
    buildDashboardTileViewModelsSpy.mockReturnValue(builtTiles as any);

    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: ChartTypes.ColumnsVertical,
            dataType: DataAscent.type,
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.ActivityType,
            size: { columns: 1, rows: 1 },
          }],
        },
        summariesSettings: {
          removeAscentForEventTypes: [ActivityTypes.Running],
          removeDescentForEventTypes: [ActivityTypes.Cycling],
        },
      },
    } as any;
    component.events = [{ id: 'event-1' }] as any;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
      events: {
        currentValue: component.events,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    expect(buildDashboardTileViewModelsSpy).toHaveBeenCalledWith({
      tiles: component.user.settings.dashboardSettings.tiles,
      events: component.events,
      preferences: {
        removeAscentForEventTypes: [ActivityTypes.Running],
        removeDescentForEventTypes: [ActivityTypes.Cycling],
      },
      logger: mockLogger,
    });
    expect(component.tiles).toBe(builtTiles);
  });

  it('should rebuild tiles when dashboard settings mutate in place', async () => {
    const initialTiles = [{
      type: TileTypes.Chart,
      order: 0,
      chartType: ChartTypes.IntensityZones,
      data: [],
      timeInterval: TimeIntervals.Auto,
      size: { columns: 1, rows: 1 },
    }] as any[];
    const updatedTiles = [{
      type: TileTypes.Chart,
      order: 0,
      chartType: ChartTypes.ColumnsVertical,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    }] as any[];

    buildDashboardTileViewModelsSpy
      .mockReturnValueOnce(initialTiles as any)
      .mockReturnValueOnce(updatedTiles as any);

    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: ChartTypes.IntensityZones,
            dataType: DataAscent.type,
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.ActivityType,
            size: { columns: 1, rows: 1 },
          }],
        },
      },
    } as any;
    component.events = [];

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
      events: {
        currentValue: component.events,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    component.user.settings.dashboardSettings.tiles[0].chartType = ChartTypes.ColumnsVertical;
    component.ngDoCheck();

    expect(buildDashboardTileViewModelsSpy).toHaveBeenCalledTimes(2);
    expect((component.tiles[0] as any).chartType).toBe(ChartTypes.ColumnsVertical);
  });
});
