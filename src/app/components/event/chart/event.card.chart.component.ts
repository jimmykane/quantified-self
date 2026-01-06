import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, NgZone, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { ActivityInterface, ActivityTypes } from '@sports-alliance/sports-lib';
import { EventInterface } from '@sports-alliance/sports-lib';
import type * as am4core from '@amcharts/amcharts4/core';
import type * as am4charts from '@amcharts/amcharts4/charts';
import type { AxisRendererY, XYSeries } from '@amcharts/amcharts4/charts';
import { AmChartsService } from '../../../services/am-charts.service';

import { Subscription, Subject, asyncScheduler } from 'rxjs';
import { AppEventService } from '../../../services/app.event.service';
import { DataAltitude } from '@sports-alliance/sports-lib';
import { debounceTime, take, throttleTime } from 'rxjs/operators';
import { StreamInterface } from '@sports-alliance/sports-lib';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import { DataPace, DataPaceMinutesPerMile } from '@sports-alliance/sports-lib';
import {
  ChartCursorBehaviours,
  XAxisTypes
} from '@sports-alliance/sports-lib';
import { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { ChartAbstractDirective } from '../../charts/chart-abstract.directive';
import { DataDistance } from '@sports-alliance/sports-lib';
import { isNumber } from '@sports-alliance/sports-lib';
import { ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { DataSwimPace, DataSwimPaceMinutesPer100Yard } from '@sports-alliance/sports-lib';
import { DataSwimPaceMaxMinutesPer100Yard } from '@sports-alliance/sports-lib';
import { DataGPSAltitude } from '@sports-alliance/sports-lib';
import { DataAccumulatedPower } from '@sports-alliance/sports-lib';
import { DataTemperature } from '@sports-alliance/sports-lib';
import {
  DataSpeed,
  DataSpeedFeetPerMinute,
  DataSpeedFeetPerSecond,
  DataSpeedKilometersPerHour,
  DataSpeedKnots,
  DataSpeedMetersPerMinute,
  DataSpeedMilesPerHour
} from '@sports-alliance/sports-lib';
import { LapTypes } from '@sports-alliance/sports-lib';
import { AppDataColors } from '../../../services/color/app.data.colors';
import { AppWindowService } from '../../../services/app.window.service';
import { DataStrydSpeed } from '@sports-alliance/sports-lib';
import {
  DataVerticalSpeed,
  DataVerticalSpeedFeetPerHour,
  DataVerticalSpeedFeetPerMinute,
  DataVerticalSpeedFeetPerSecond,
  DataVerticalSpeedKilometerPerHour,
  DataVerticalSpeedMetersPerHour,
  DataVerticalSpeedMetersPerMinute,
  DataVerticalSpeedMilesPerHour
} from '@sports-alliance/sports-lib';
import { DataPower } from '@sports-alliance/sports-lib';
import { DataPowerRight } from '@sports-alliance/sports-lib';
import { DataPowerLeft } from '@sports-alliance/sports-lib';
import { DataLeftBalance } from '@sports-alliance/sports-lib';
import { DataRightBalance } from '@sports-alliance/sports-lib';
import { DataStrydDistance } from '@sports-alliance/sports-lib';
import { DataEHPE } from '@sports-alliance/sports-lib';
import { DataSeaLevelPressure } from '@sports-alliance/sports-lib';
import { DataStrydAltitude } from '@sports-alliance/sports-lib';
import { DataEVPE } from '@sports-alliance/sports-lib';
import { DataAbsolutePressure } from '@sports-alliance/sports-lib';
import { ChartHelper, LabelData } from './chart-helper';
import type * as am4plugins_annotation from '@amcharts/amcharts4/plugins/annotation';

import { DataAirPower } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../services/app.user.service';
import { AppChartSettingsLocalStorageService } from '../../../services/storage/app.chart.settings.local.storage.service';
import { User } from '@sports-alliance/sports-lib';
import { AppActivityCursorService } from '../../../services/activity-cursor/app-activity-cursor.service';
import {
  DataGradeAdjustedPace,
  DataGradeAdjustedPaceMinutesPerMile
} from '@sports-alliance/sports-lib';
import {
  DataGradeAdjustedSpeed,
  DataGradeAdjustedSpeedFeetPerMinute,
  DataGradeAdjustedSpeedFeetPerSecond,
  DataGradeAdjustedSpeedKilometersPerHour,
  DataGradeAdjustedSpeedKnots,
  DataGradeAdjustedSpeedMetersPerMinute,
  DataGradeAdjustedSpeedMilesPerHour
} from '@sports-alliance/sports-lib';
import { DataLatitudeDegrees } from '@sports-alliance/sports-lib';
import { DataLongitudeDegrees } from '@sports-alliance/sports-lib';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppEventInterface } from '../../../../../functions/src/shared/app-event.interface';
import { AppColors } from '../../../services/color/app.colors';
import { ActivityUtilities } from '@sports-alliance/sports-lib';
import { LoggerService } from '../../../services/logger.service';

const DOWNSAMPLE_AFTER_X_HOURS = 8;
const DOWNSAMPLE_FACTOR_PER_HOUR = 1.5;

@Component({
  selector: 'app-event-card-chart',
  templateUrl: './event.card.chart.component.html',
  styleUrls: ['./event.card.chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class EventCardChartComponent extends ChartAbstractDirective implements OnChanges, OnInit, OnDestroy, AfterViewInit {

  @Input() event: EventInterface;
  @Input() targetUserID: string;
  @Input() user: User;
  @Input() userUnitSettings: UserUnitSettingsInterface;
  @Input() selectedActivities: ActivityInterface[] = [];
  @Input() isVisible: boolean;
  @Input() showAllData: boolean;
  @Input() showLaps: boolean;
  @Input() showGrid: boolean;
  @Input() disableGrouping: boolean;
  @Input() hideAllSeriesOnInit: boolean;
  @Input() lapTypes: LapTypes[];
  @Input() xAxisType: XAxisTypes;
  @Input() downSamplingLevel: number;
  @Input() gainAndLossThreshold: number;
  @Input() waterMark?: string;
  @Input() chartCursorBehaviour: ChartCursorBehaviours;
  @Input() stackYAxes = false;
  @Input() strokeWidth: number;
  @Input() strokeOpacity: number;
  @Input() fillOpacity: number;
  @Input() extraMaxForPower: number;
  @Input() extraMaxForPace: number;
  @Input() dataTypesToUse: string[];
  @Output() loadingStatus = new EventEmitter<boolean>();


  public distanceAxesForActivitiesMap = new Map<string, StreamInterface>();
  protected declare chart: am4charts.XYChart;

  private core: typeof am4core;
  private charts: typeof am4charts;
  private annotationPlugin: typeof am4plugins_annotation;


  private streamsSubscription: Subscription;
  private activitiesCursorSubscription: Subscription;
  private cursorPositionSubject = new Subject<any>();
  private cursorPositionSubscription: Subscription;

  private activitiesWithAllStreamsFetched = new Set<string>();
  private processSequence = 0;

  private rangeLabelsContainer: am4core.Container | undefined;
  private clearSelectionButton: am4core.Button | undefined;

  constructor(changeDetector: ChangeDetectorRef,
    protected zone: NgZone,
    private windowService: AppWindowService,
    private eventService: AppEventService,
    private chartSettingsLocalStorageService: AppChartSettingsLocalStorageService,
    private activityCursorService: AppActivityCursorService,
    private snackBar: MatSnackBar,
    private eventColorService: AppEventColorService,
    protected amChartsService: AmChartsService,
    protected logger: LoggerService) {
    super(zone, changeDetector, amChartsService, logger);
  }

  public override loading() {
    super.loading();
    this.loadingStatus.emit(true);
  }

  public override loaded() {
    super.loaded();
    this.loadingStatus.emit(false);
  }


  async ngAfterViewInit() {

    this.chart = await this.createChart();

    await this.processChanges(++this.processSequence);
  }

  async ngOnInit() {

    if (!this.targetUserID || !this.event) {
      throw new Error('Component needs events and users');
    }

    // Subscribe to cursor position changes with throttling
    this.cursorPositionSubscription = this.cursorPositionSubject.pipe(
      throttleTime(1000, asyncScheduler, { leading: true, trailing: true })
    ).subscribe((event) => {
      this.handleCursorPositionChange(event);
    });
  }

  async ngOnChanges(simpleChanges: SimpleChanges) {
    if (!this.chart) {
      return; // Chart not yet initialized
    }

    // #1: Identify changes that REQUIRE full rebuild vs. partial updates
    const requiresFullRebuild =
      simpleChanges.chartTheme
      || simpleChanges.xAxisType
      || simpleChanges.stackYAxes
      || simpleChanges.chartCursorBehaviour
      || simpleChanges.disableGrouping
      || simpleChanges.event
      || simpleChanges.selectedActivities
      || simpleChanges.showAllData
      || simpleChanges.lapTypes
      || simpleChanges.extraMaxForPower
      || simpleChanges.extraMaxForPace
      || simpleChanges.hideAllSeriesOnInit
      || simpleChanges.strokeWidth
      || simpleChanges.fillOpacity
      || simpleChanges.dataTypesToUse
      || simpleChanges.downSamplingLevel
      || simpleChanges.gainAndLossThreshold;

    // Changes that can be handled with partial updates
    const canPartialUpdate =
      (simpleChanges.showLaps || simpleChanges.showGrid)
      && !requiresFullRebuild;

    if (canPartialUpdate) {
      // #1: Handle showLaps toggle without rebuild
      if (simpleChanges.showLaps) {
        this.removeLapGuides(this.chart);
        if (this.showLaps) {
          this.addLapGuides(this.chart, this.selectedActivities, this.xAxisType, this.lapTypes);
        }
      }

      // #1: Handle showGrid toggle without rebuild
      if (simpleChanges.showGrid) {
        if (this.showGrid) {
          this.addGrid();
        } else {
          this.removeGrid();
        }
      }
      return; // Exit early - no full rebuild needed
    }

    if (requiresFullRebuild || simpleChanges.showLaps || simpleChanges.showGrid) {
      // Show loading immediately so the user sees feedback
      this.loading();
      this.changeDetector.detectChanges();

      // #8: Only clear distance cache when activities actually change
      if (simpleChanges.event || simpleChanges.selectedActivities) {
        this.distanceAxesForActivitiesMap.clear();
      }

      // #2: Temporarily disable animations during rebuild for better performance
      const originalAnimationSetting = this.useAnimations;
      this.useAnimations = false;

      // Use requestAnimationFrame to ensure paint happens before heavy work
      requestAnimationFrame(() => {
        setTimeout(async () => {
          this.destroyChart();
          this.activityCursorService.clear();
          this.eventColorService.clearCache();

          // Re-create the empty chart shell
          this.chart = await this.createChart();

          // Restore animation setting after chart is created
          this.useAnimations = originalAnimationSetting;

          // Proceed to populate data
          const seq = ++this.processSequence;
          if (!this.event || !this.selectedActivities?.length) {
            this.loaded();
            return;
          }
          await this.processChanges(seq);
        }, 0);
      });
    }
  }


  ngOnDestroy() {
    this.unSubscribeFromAll();
    if (this.cursorPositionSubscription) {
      this.cursorPositionSubscription.unsubscribe();
    }
    super.ngOnDestroy();
  }

  getFillColor(chart: am4charts.XYChart | am4charts.PieChart, index: number) {
    return chart.colors.getIndex(index * 2);
  }

  protected setupChart(chart: am4charts.XYChart) {

  }

  protected async createChart(): Promise<am4charts.XYChart> {
    const modules = await this.amChartsService.load();
    this.core = modules.core;
    this.charts = modules.charts;
    this.annotationPlugin = await import('@amcharts/amcharts4/plugins/annotation');

    // @hack to 'fix' multisport
    if (this.event.isMultiSport()) {
      this.xAxisType = XAxisTypes.Time;
    }
    // am4core options handled in service
    const chart = await super.createChart(this.charts.XYChart) as am4charts.XYChart;

    chart.fontSize = '1em';
    chart.padding(0, 10, 0, 0);
    // chart.resizable = false;

    chart.durationFormatter.durationFormat = 'mm:ss';

    // Add scrollbar
    chart.scrollbarX = new this.core.Scrollbar();

    chart.scrollbarX.startGrip.disabled = true;
    chart.scrollbarX.endGrip.disabled = true;
    chart.scrollbarX.marginTop = 0;
    chart.scrollbarX.marginBottom = 10;

    if (this.stackYAxes) {
      ChartHelper.setYAxesToStack(chart);
    } else {
      ChartHelper.unsetYAxesToStack(chart);
    }

    chart.xAxes.push(this.addXAxis(chart, this.xAxisType));

    // Create a Legend
    this.attachChartLegendToChart(chart);
    // Create a cursor
    chart.cursor = new this.charts.XYCursor();


    chart.cursor.interactions.hitOptions.hitTolerance = 20;
    chart.cursor.interactions.hitOptions.noFocus = true;

    chart.cursor.behavior = 'none'; // Disable initially to prevent auto-zooms
    chart.cursor.zIndex = 10;
    chart.cursor.hideSeriesTooltipsOnSelection = true;

    chart.zoomOutButton.icon.path = 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z'
    const tempButton = new this.core.Button();


    chart.zoomOutButton.background.fill = tempButton.background.fill;
    chart.zoomOutButton.icon.stroke = tempButton.label.stroke;
    chart.zoomOutButton.strokeWidth = tempButton.label.strokeWidth;

    chart.zoomOutButton.icon.padding(0, 0, 0, 0);
    chart.zoomOutButton.padding(13, 12, 13, 12);
    chart.zoomOutButton.fontSize = '1.2em';
    chart.zoomOutButton.dx = -88;
    chart.zoomOutButton.dy = 4;


    // chart.zoomOutButton.padding(0,0,0,0)
    chart.zoomOutButton.background.cornerRadius(5, 5, 5, 5);


    chart.cursor.events.on('cursorpositionchanged', (event) => {
      this.cursorPositionSubject.next(event);
    });


    // On select
    chart.cursor.events.on('selectended', (ev) => {
      this.logger.info('EventCardChartComponent: selectended triggered');
      if (!ev.target.xRange) {
        this.logger.warn('EventCardChartComponent: No xRange in event target');
        return;
      }
      this.disposeRangeLabelsContainer(ev.target.chart);
      this.disposeClearSelectionButton(ev.target.chart);
      this.addClearSelectionButton(ev.target.chart);

      const rangeLabelsContainer = this.createRangeLabelsContainer(ev.target.chart);
      const axis = ev.target.chart.xAxes.getIndex(0);
      let start;
      let end;
      switch (this.xAxisType) {
        case XAxisTypes.Time:
          start = (<am4charts.DateAxis>axis).positionToDate ? (<am4charts.DateAxis>axis).positionToDate(axis.toAxisPosition(ev.target.xRange.start)) : new Date();
          end = (<am4charts.DateAxis>axis).positionToDate ? (<am4charts.DateAxis>axis).positionToDate(axis.toAxisPosition(ev.target.xRange.end)) : new Date();
          break;
        case XAxisTypes.Duration:
          start = (<am4charts.DateAxis>axis).positionToDate ? (<am4charts.DateAxis>axis).positionToDate(axis.toAxisPosition(ev.target.xRange.start)) : new Date();
          end = (<am4charts.DateAxis>axis).positionToDate ? (<am4charts.DateAxis>axis).positionToDate(axis.toAxisPosition(ev.target.xRange.end)) : new Date();
          break;
        default:
          start = (<am4charts.ValueAxis>axis).positionToValue(axis.toAxisPosition(ev.target.xRange.start));
          end = (<am4charts.ValueAxis>axis).positionToValue(axis.toAxisPosition(ev.target.xRange.end));
          break;
      }

      // alert('Selected start ' + start + ' end ' + end);
      // Now since we know the actual start end we need end iterate over the visible series and calculate AVG, Max,Min, Gain and loss not an easy job I suppose
      this.logger.info('EventCardChartComponent: Iterating series to create labels');
      this.chart.series.values.forEach(series => {
        try {
          if (!series.dummyData || !series.dummyData.stream) {
            this.logger.warn(`EventCardChartComponent: Series ${series.name || series.id} missing dummyData or stream`);
            return;
          }

          let data;
          switch (this.xAxisType) {
            case XAxisTypes.Time:
              data = series.data.reduce((array, dataItem) => {
                if (new Date(dataItem.time) >= start && new Date(dataItem.time) <= end) {
                  array.push(dataItem.value);
                }
                return array
              }, []);
              break;
            case XAxisTypes.Duration:
              data = series.data.reduce((array, dataItem) => {
                if (new Date(dataItem.time) >= start && new Date(dataItem.time) <= end) {
                  array.push(dataItem.value);
                }
                return array
              }, []);
              break;
            default:
              data = series.data.reduce((array, dataItem) => {
                if (dataItem.axisValue >= start && dataItem.axisValue <= end) {
                  array.push(dataItem.value);
                }
                return array
              }, []);
              break;
          }

          if (!data.length) {
            return;
          }

          // Here we have all the data we need
          const dataTypeUnit = DynamicDataLoader.getDataClassFromDataType(series.dummyData.stream.type).unit;
          const labelData = <LabelData>{
            name: DynamicDataLoader.getDataClassFromDataType(series.dummyData.stream.type).displayType || DynamicDataLoader.getDataClassFromDataType(series.dummyData.stream.type).type,
            average: {
              value: data.length ? `${<string>DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, ActivityUtilities.getAverage(data)).getDisplayValue()}` : '--',
              unit: `${<string>DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, ActivityUtilities.getAverage(data)).getDisplayUnit()}`
            },
            max: {
              value: data.length ? `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, ActivityUtilities.getMax(data)).getDisplayValue()}` : '--',
              unit: `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, ActivityUtilities.getMax(data)).getDisplayUnit()}`
            },
            min: {
              value: data.length ? `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, ActivityUtilities.getMin(data)).getDisplayValue()}` : '--',
              unit: `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, ActivityUtilities.getMin(data)).getDisplayUnit()}`
            },
            minToMaxDiff: {
              value: data.length ? `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, ActivityUtilities.getMax(data) - ActivityUtilities.getMin(data)).getDisplayValue()}` : '--',
              unit: `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, ActivityUtilities.getMax(data) - ActivityUtilities.getMin(data)).getDisplayUnit()}`
            }
          };
          if (this.doesDataTypeSupportGainOrLoss(series.dummyData.stream.type)) {
            labelData.gain = {
              value: data.length ? `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, ActivityUtilities.getGainOrLoss(data, true, this.gainAndLossThreshold)).getDisplayValue()}` : '--',
              unit: `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, ActivityUtilities.getGainOrLoss(data, true, this.gainAndLossThreshold)).getDisplayUnit()}`
            };
            labelData.loss = {
              value: data.length ? `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, ActivityUtilities.getGainOrLoss(data, false, this.gainAndLossThreshold)).getDisplayValue()}` : '--',
              unit: `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, ActivityUtilities.getGainOrLoss(data, false, this.gainAndLossThreshold)).getDisplayUnit()}`
            };
          }
          if (this.doesDataTypeSupportSlope(series.dummyData.stream.type) && this.xAxisType === XAxisTypes.Distance) {
            labelData.slopePercentage = {
              value: data.length ? `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, (ActivityUtilities.getMax(data) - ActivityUtilities.getMin(data)) / (end - start) * 100).getDisplayValue()}` : '--',
              unit: `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, (ActivityUtilities.getMax(data) - ActivityUtilities.getMin(data)) / (end - start) * 100).getDisplayUnit()}`
            };
          }
          // Todo should group pace and derived units
          // Should use dynamic data loader
          this.logger.info(`EventCardChartComponent: Creating label for series ${series.name || series.id}`);
          this.createLabel(rangeLabelsContainer, series, labelData, series.hidden);
        } catch (error) {
          this.logger.error(`EventCardChartComponent: Error processing series ${series.name || series.id}`, error);
        }
      });

    });

    // Add zoom button
    this.addZoomOrSelectButton(chart);


    // Add watermark
    chart.plotContainer.children.push(ChartHelper.getWaterMark(this.core, this.waterMark));

    // watermark.fontWeight = 'bold';


    // Scrollbar
    // chart.scrollbarX = new am4charts.XYChartScrollbar();

    // Add exporting options
    chart.exporting.menu = new this.core.ExportMenu();

    chart.exporting.extraSprites.push({
      'sprite': chart.legend.parent,
      'position': 'bottom',
      'marginTop': 20
    });

    // Add the anotation
    chart.plugins.push(new this.annotationPlugin.Annotation());


    // Attach events
    chart.events.on('validated', (ev) => {

    });

    chart.events.on('globalscalechanged', (ev) => {

    });

    chart.events.on('dataitemsvalidated', (ev) => {

    });


    chart.events.on('datavalidated', (ev) => {

    });

    chart.events.on('datarangechanged', (ev) => {

    });

    chart.events.on('ready', (ev) => {

    });


    chart.events.on('shown', (ev) => {

    });

    chart.events.on('transformed', (ev) => {

    });

    chart.events.on('maxsizechanged', (ev) => {

      ev.target.legend.svgContainer.htmlElement.style.height = this.chart.legend.contentHeight + 'px'; // @todo test
    });

    chart.events.on('visibilitychanged', (ev) => {

    });

    chart.events.on('hidden', (ev) => {

    });
    chart.events.on('shown', (ev) => {

    });

    chart.events.on('inited', (ev) => {

    });

    return chart;
  }

  protected disposeRangeLabelsContainer(chart: am4charts.XYChart) {
    if (this.rangeLabelsContainer) {
      this.rangeLabelsContainer.dispose();
      this.rangeLabelsContainer = undefined;
    }
  }

  protected disposeClearSelectionButton(chart: am4charts.XYChart) {
    if (this.clearSelectionButton) {
      this.clearSelectionButton.dispose();
      this.clearSelectionButton = undefined;
    }
  }



  protected disposeCursorSelection(chart: am4charts.XYChart) {
    const cursor = chart.cursor;
    if (cursor && cursor.selection) {
      // const a = cursor;
      // debugger;
      // @todo clear selection
      cursor.xRange = null;
      cursor.yRange = null;
      cursor.invalidate();
    }
  }

  // @todo move to data class
  protected doesDataTypeSupportGainOrLoss(dataType: string): boolean {
    switch (dataType) {
      case DataAltitude.type:
      case DataGPSAltitude.type:
      case DataAccumulatedPower.type:
      case DataTemperature.type:
        return true;
      default:
        return false;
    }
  }

  // @todo move to data class
  protected doesDataTypeSupportSlope(dataType: string): boolean {
    switch (dataType) {
      case DataAltitude.type:
      case DataGPSAltitude.type:
      case DataAccumulatedPower.type:
      case DataTemperature.type:
        return true;
      default:
        return false;
    }
  }

  protected getSubscriptions(): Subscription[] {
    const subscriptions = [];
    if (this.streamsSubscription) {
      subscriptions.push(this.streamsSubscription)
    }
    if (this.activitiesCursorSubscription) {
      subscriptions.push(this.activitiesCursorSubscription);

    }
    return subscriptions;
  }

  protected attachSeriesEventListeners(series: am4charts.XYSeries) {
    // Shown
    // series.events.on('visibilitychanged', () => {

    // });
    series.events.on('shown', () => {

      series.hidden = false;
      this.showSeriesYAxis(series);

      if (this.getSeriesRangeLabelContainer(series)) {
        this.getSeriesRangeLabelContainer(series).disabled = false;
        this.getSeriesRangeLabelContainer(series).deepInvalidate();
      }

      series.yAxis.height = this.core.percent(100);

      series.yAxis.invalidate();
      // series.yAxis.invalidateLayout()
      // series.yAxis.invalidateSeries()
      series.yAxis.invalidateLabels()
      this.chartSettingsLocalStorageService.showSeriesID(this.event, series.id);
    });
    // Hidden
    series.events.on('hidden', () => {

      series.hidden = true;
      if (!this.getVisibleSeriesWithSameYAxis(series).length) {
        this.hideSeriesYAxis(series)
      }

      if (this.getSeriesRangeLabelContainer(series)) {
        this.getSeriesRangeLabelContainer(series).disabled = true;
      }
      // @todo should check for same visibel might need -1
      if (!this.getVisibleSeriesWithSameYAxis(series).length) {
        series.yAxis.height = 0;
      }
      // series.yAxis.disabled = true;
      series.yAxis.invalidate();
      // series.yAxis.invalidateLayout()
      // series.yAxis.invalidateSeries()
      series.yAxis.invalidateLabels()

      this.chartSettingsLocalStorageService.hideSeriesID(this.event, series.id);
    });
  }

  protected createYAxisForSeries(streamType: string): am4charts.ValueAxis | am4charts.DurationAxis {
    let yAxis: am4charts.ValueAxis | am4charts.DurationAxis;
    if ([DataPace.type, DataPaceMinutesPerMile.type, DataGradeAdjustedPace.type, DataGradeAdjustedPaceMinutesPerMile.type, DataSwimPace.type, DataSwimPaceMaxMinutesPer100Yard.type].indexOf(streamType) !== -1) {
      yAxis = new this.charts.DurationAxis();
    } else {
      yAxis = new this.charts.ValueAxis();
    }

    return yAxis;
  }

  protected hideSeriesYAxis(series: am4charts.XYSeries) {
    series.yAxis.disabled = true;
  }

  protected showSeriesYAxis(series: am4charts.XYSeries) {
    series.yAxis.disabled = false;
  }

  protected getVisibleSeriesWithSameYAxis(series: am4charts.XYSeries): am4charts.XYSeries[] {
    return this.getVisibleSeries(series.chart).filter(serie => serie.id !== series.id).filter(serie => serie.name === series.name);
  }

  protected getSameNameSeries(series: am4charts.XYSeries): am4charts.XYSeries[] {
    return series.chart.series.values.filter(serie => serie.name === series.name);
  }

  protected getVisibleSeries(chart: am4charts.XYChart): am4charts.XYSeries[] {
    return chart.series.values
      .filter(series => !series.hidden);
  }

  // This helps to goup series vy providing the same name (type) for things that should have the same axis
  protected getSeriesName(name: string) {
    if ([DataAltitude.type, DataGPSAltitude.type, DataStrydAltitude.type].indexOf(name) !== -1) {
      return DataAltitude.type;
    }
    if ([DataEHPE.type, DataEVPE.type].indexOf(name) !== -1) {
      return 'Positional Error'
    }
    if ([DataAbsolutePressure.type, DataSeaLevelPressure.type].indexOf(name) !== -1) {
      return 'Pressure'
    }
    if ([DataPace.type, DataPaceMinutesPerMile.type].indexOf(name) !== -1) {
      return 'Pace'
    }
    if ([DataGradeAdjustedPace.type, DataGradeAdjustedPaceMinutesPerMile.type].indexOf(name) !== -1) {
      return 'Pace'
    }
    if ([
      DataSpeed.type,
      DataStrydSpeed.type,
      DataSpeedMetersPerMinute.type,
      DataSpeedFeetPerMinute.type,
      DataSpeedFeetPerSecond.type,
      DataSpeedMilesPerHour.type,
      DataSpeedKilometersPerHour.type,
      DataSpeedKnots.type,
      DataGradeAdjustedSpeed.type,
      DataGradeAdjustedSpeedMetersPerMinute.type,
      DataGradeAdjustedSpeedFeetPerMinute.type,
      DataGradeAdjustedSpeedFeetPerSecond.type,
      DataGradeAdjustedSpeedMilesPerHour.type,
      DataGradeAdjustedSpeedKilometersPerHour.type,
      DataGradeAdjustedSpeedKnots.type,
    ].indexOf(name) !== -1) {
      return 'Speed'
    }
    if ([DataVerticalSpeed.type,
    DataVerticalSpeedFeetPerSecond.type,
    DataVerticalSpeedMetersPerMinute.type,
    DataVerticalSpeedFeetPerMinute.type,
    DataVerticalSpeedMetersPerHour.type,
    DataVerticalSpeedFeetPerHour.type,
    DataVerticalSpeedKilometerPerHour.type,
    DataVerticalSpeedMilesPerHour.type].indexOf(name) !== -1) {
      return 'Vertical Speed'
    }
    if ([DataSwimPaceMaxMinutesPer100Yard.type, DataSwimPace.type].indexOf(name) !== -1) {
      return 'Swim Pace'
    }
    if ([DataPower.type,
    DataAirPower.type,
    DataPowerRight.type,
    DataPowerLeft.type].indexOf(name) !== -1) {
      return 'Power'
    }
    if ([DataLeftBalance.type,
    DataRightBalance.type].indexOf(name) !== -1) {
      return 'Left/Right Balance'
    }
    if ([DataDistance.type,
    DataStrydDistance.type].indexOf(name) !== -1) {
      return 'Distance'
    }
    return name;
  }



  protected async destroyChart() {
    this.destroyLegendParent();
    super.destroyChart();
  }

  private async processChanges(seq: number) {
    if (seq !== this.processSequence) {
      this.logger.warn(`[EventCardChart] processChanges aborted BEFORE starting (seq mismatch: ${seq} !== ${this.processSequence})`);
      return;
    }

    this.loading();

    // Prepare data for series creation
    const streamsToProcess: { activity: ActivityInterface, stream: StreamInterface }[] = [];

    // Lazy load additional streams is no longer supported from Firestore as streams are not stored there anymore
    // If "Show All Data" is enabled, streams should have been hydrated from the original file already
    // via attachStreamsToEventWithActivities in the event service.

    if (this.selectedActivities && this.selectedActivities.length > 0) {
      this.selectedActivities.forEach(activity => {
        const streams = activity.getAllStreams();
        if (!streams.length) {
          return;
        }

        // #8: Populate distance map for distance axis mode
        if (this.xAxisType === XAxisTypes.Distance) {
          const distanceStream = streams.find(s => s.type === DataDistance.type) || streams.find(s => s.type === DataStrydDistance.type);
          if (distanceStream) {
            this.distanceAxesForActivitiesMap.set(activity.getID(), distanceStream);
          }
        }

        // Determine which data types to show based on showAllData toggle
        const allowedDataTypes = this.showAllData
          ? null // null means show all
          : [...DynamicDataLoader.basicDataTypes, ...this.dataTypesToUse];

        // These need to be unit based and activity based?
        const shouldRemoveSpeed = DynamicDataLoader.getUnitBasedDataTypesFromDataType(DataSpeed.type, this.userUnitSettings).indexOf(DataSpeed.type) === -1
        const shouldRemoveGradeAdjustedSpeed = DynamicDataLoader.getUnitBasedDataTypesFromDataType(DataGradeAdjustedSpeed.type, this.userUnitSettings).indexOf(DataGradeAdjustedSpeed.type) === -1
        const shouldRemoveDistance = DynamicDataLoader.getNonUnitBasedDataTypes(this.showAllData, this.dataTypesToUse).indexOf(DataDistance.type) === -1;

        // @todo should do the same with distance (miles) and vertical speed
        [...new Set(ActivityUtilities.createUnitStreamsFromStreams(streams, activity.type, DynamicDataLoader.getUnitBasedDataTypesFromDataTypes(streams.map(st => st.type), this.userUnitSettings)).concat(streams))]
          .filter((stream) => {
            // First, filter by showAllData toggle
            if (allowedDataTypes !== null && !allowedDataTypes.includes(stream.type)) {
              return false;
            }

            switch (stream.type) {
              case DataDistance.type:
                return !shouldRemoveDistance;
              case DataSpeed.type:
                return !shouldRemoveSpeed;
              case DataGradeAdjustedSpeed.type:
                return !shouldRemoveGradeAdjustedSpeed;
              case DataLatitudeDegrees.type:
              case DataLongitudeDegrees.type:
                return false;
              default:
                return true;
            }
          }).sort((left, right) => {
            if (left.type < right.type) {
              return -1;
            }
            if (left.type > right.type) {
              return 1;
            }
            return 0;
          }).forEach((stream) => {
            streamsToProcess.push({ activity, stream });
          });
      });
    }

    // Process streams in chunks
    const processChunk = (index: number) => {
      // Check for cancellation
      if (seq !== this.processSequence) {
        return;
      }

      const chunkSize = 2; // Adjust chunk size as needed
      const endIndex = Math.min(index + chunkSize, streamsToProcess.length);

      for (let i = index; i < endIndex; i++) {
        const item = streamsToProcess[i];
        this.createOrUpdateChartSeries(item.activity, item.stream);
      }

      if (endIndex < streamsToProcess.length) {
        requestAnimationFrame(() => processChunk(endIndex));
      } else {
        // All done
        this.finalizeChartSetup(seq);
      }
    };

    // Start processing
    if (streamsToProcess.length > 0) {
      processChunk(0);
    } else {
      this.finalizeChartSetup(seq);
    }
  }

  private finalizeChartSetup(seq: number) {
    if (seq !== this.processSequence) {
      return;
    }

    if (this.showGrid) {
      this.addGrid();
    } else {
      this.removeGrid();
    }
    if (this.showLaps) {
      this.addLapGuides(this.chart, this.selectedActivities, this.xAxisType, this.lapTypes);
    }

    // Since we created series, we can get them from chart
    const series = this.chart.series.values;

    // Show if needed without animations to prevent unwanted auto-zooms
    series.forEach(s => this.shouldHideSeries(s) ? s.hide(0) : s.show(0));
    // Store at local storage the visible / non visible series
    series.forEach(s => s.hidden ? this.chartSettingsLocalStorageService.hideSeriesID(this.event, s.id) : this.chartSettingsLocalStorageService.showSeriesID(this.event, s.id));
    // Snap to series will be set after zoom reset to avoid interference

    if (this.xAxisType === XAxisTypes.Time) {
      // this.addStartPauseSeriesRanges(this.chart, this.xAxisType, series);
      this.addStartPauseTimeAxisRanges(<am4charts.DateAxis>this.chart.xAxes.getIndex(0));
    }

    // #5: Robust Zoom Reset for Multi-Activity charts
    // Wrapped in a longer timeout to ensure ALL chunks are processed and amCharts has stable ranges.
    // Multi-activity charts often conflict with amCharts automatic mini-validation cycles.
    setTimeout(() => {
      if (!this.chart || !this.chart.xAxes) {
        return;
      }

      // Calculate total max distance and duration for explicit zoom
      let totalMaxDistance = 0;
      let totalMaxDuration = 0;
      const durationStart = 0;

      let minTime = Infinity;
      let maxTime = -Infinity;

      this.selectedActivities.forEach(a => {
        if (this.xAxisType === XAxisTypes.Distance) {
          const distanceResult: any = a.getDistance ? a.getDistance() : 0;
          const distance = typeof distanceResult === 'number' ? distanceResult : (distanceResult?.value || 0);
          if (distance > totalMaxDistance) {
            totalMaxDistance = distance;
          }
        }
        if (this.xAxisType === XAxisTypes.Duration) {
          const durationResult: any = a.getDuration();
          const duration = typeof durationResult === 'number' ? durationResult : (durationResult?.value || 0);
          if (duration > totalMaxDuration) {
            totalMaxDuration = duration;
          }
        }
        if (this.xAxisType === XAxisTypes.Time) {
          const startTime = a.startDate.getTime();
          const endTime = a.endDate.getTime();
          if (startTime < minTime) {
            minTime = startTime;
          }
          if (endTime > maxTime) {
            maxTime = endTime;
          }
        }
      });

      this.chart.invalidateData(); // One last re-eval of all series data

      this.chart.xAxes.each(axis => {
        // Disable any persistent selection and force recalculation
        (axis as any).keepSelection = false;

        if (this.xAxisType === XAxisTypes.Distance && totalMaxDistance > 0 && axis instanceof this.charts.ValueAxis) {
          // Reset first to force clean state
          axis.min = undefined;
          axis.max = undefined;
          axis.strictMinMax = false;

          axis.min = 0;
          axis.max = totalMaxDistance;
          axis.strictMinMax = true; // Lock to the full range

          if ((axis as any).zoomToValues) {
            (axis as any).zoomToValues(0, totalMaxDistance, false, true);
          }
        } else if (this.xAxisType === XAxisTypes.Duration && totalMaxDuration > 0 && axis instanceof this.charts.DateAxis) {
          // Reset first to force clean state
          axis.min = undefined;
          axis.max = undefined;
          axis.strictMinMax = false;

          axis.min = durationStart;
          axis.max = durationStart + (totalMaxDuration + 2) * 1000; // Add 2s buffer
          // axis.strictMinMax = true; // Relax to allow amCharts some flexibility

          axis.zoom({ start: 0, end: 1 }, false, true);
        } else if (this.xAxisType === XAxisTypes.Time && minTime !== Infinity && axis instanceof this.charts.DateAxis) {
          // Reset first to force clean state
          axis.min = undefined;
          axis.max = undefined;
          axis.strictMinMax = false;

          axis.min = minTime;
          axis.max = maxTime;

          axis.zoom({ start: 0, end: 1 }, false, true);
        } else {
          axis.start = 0;
          axis.end = 1;
          axis.zoom({ start: 0, end: 1 }, false, true);
        }
      });

      if (this.chart.scrollbarX) {
        this.chart.scrollbarX.start = 0;
        this.chart.scrollbarX.end = 1;
        (this.chart.scrollbarX as any).zoom({ start: 0, end: 1 }, false, true);
      }

      // Re-enable cursor behavior after zoom is stable
      if (this.chart.cursor) {
        this.chart.cursor.behavior = this.chartCursorBehaviour;
        // Re-enable snapping after zoom is stable
        if (this.xAxisType === XAxisTypes.Distance) {
          this.chart.cursor.snapToSeries = this.chart.series.values;
        }
      }


      this.changeDetector.detectChanges();
    }, 2000); // Increased delay to 2s to be absolutely sure

    this.loaded();
    this.changeDetector.detectChanges();
  }

  private createOrUpdateChartSeries(activity: ActivityInterface, stream: StreamInterface): am4charts.XYSeries {
    // @todo try run outside angular
    let series = this.chart.series.values.find(seriesItem => seriesItem.id === this.getSeriesIDFromActivityAndStream(activity, stream));
    // If there is already a series with this id only data update should be done
    if (series) {
      series.data = this.convertStreamDataToSeriesData(activity, stream);
      return series
    }

    // Create a new series if not found
    series = new this.charts.LineSeries();

    series.showOnInit = false;
    series.id = this.getSeriesIDFromActivityAndStream(activity, stream);
    series.simplifiedProcessing = true;
    series.name = this.getSeriesName(stream.type);

    // Setup the series
    series.dummyData = {
      activity: activity,
      stream: stream,
      displayName: DynamicDataLoader.getDataClassFromDataType(stream.type).displayType
    };

    this.attachSeriesEventListeners(series);

    series.tooltipText = ([DataPace.type, DataSwimPace.type, DataSwimPaceMinutesPer100Yard.type, DataPaceMinutesPerMile.type, DataGradeAdjustedPace.type, DataGradeAdjustedPaceMinutesPerMile.type].indexOf(stream.type) !== -1) ?
      `${this.event.getActivities().length === 1 || this.event.isMultiSport() ? '' : activity.creator.name} ${DynamicDataLoader.getDataClassFromDataType(stream.type).type} {valueY.formatDuration()} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit}`
      : `${this.event.getActivities().length === 1 || this.event.isMultiSport() ? '' : activity.creator.name} ${DynamicDataLoader.getDataClassFromDataType(stream.type).displayType || DynamicDataLoader.getDataClassFromDataType(stream.type).type} {valueY} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit}`;

    series.legendSettings.labelText = `${DynamicDataLoader.getDataClassFromDataType(stream.type).displayType || DynamicDataLoader.getDataClassFromDataType(stream.type).type} ` + (DynamicDataLoader.getDataClassFromDataType(stream.type).unit ? ` (${DynamicDataLoader.getDataClassFromDataType(stream.type).unit})` : '') + ` [${this.core.color(this.eventColorService.getActivityColor(this.event.getActivities(), activity)).toString()}]${this.event.getActivities().length === 1 || this.event.isMultiSport() ? '' : activity.creator.name}[/]`;

    series.adapter.add('fill', (fill, target) => {
      return this.getSeriesColor(target);
    });
    series.adapter.add('stroke', (fill, target) => {
      return this.getSeriesColor(target);
    });

    // series.hideTooltipWhileZooming = true;
    // yAxis.title.rotation = 0;

    series.strokeWidth = this.strokeWidth;
    series.strokeOpacity = this.strokeOpacity;
    series.fillOpacity = this.fillOpacity;
    // series.defaultState.transitionDuration = 0;

    series.dataFields.valueY = 'value';
    if (this.xAxisType === XAxisTypes.Distance) {
      series.dataFields.valueX = 'axisValue';
    } else {
      series.dataFields.dateX = 'time';
      series.dataFields.valueX = 'axisValue'; // Fallback / Duration mode
    }
    // series.dataFields.categoryX = 'distance';

    // series.interactionsEnabled = false; // Container handles this


    // Attach events
    series.events.on('validated', (ev) => {
      //
      ev.target.chart.legend.svgContainer.htmlElement.style.height = this.chart.legend.contentHeight + 'px';
      // this.loaded();
    });

    series.events.on('ready', (ev) => {

    });

    series.data = this.convertStreamDataToSeriesData(activity, stream);
    series.yAxis = this.getYAxisForSeries(series);
    series = this.chart.series.push(series);
    return series;
  }

  private getYAxisForSeries(series: XYSeries) {
    let yAxis: am4charts.ValueAxis | am4charts.DurationAxis;
    const sameTypeSeries = this.chart.series.values.find((serie) => serie.name === this.getSeriesName(series.dummyData.stream.type));
    if (sameTypeSeries) {
      yAxis = <am4charts.ValueAxis | am4charts.DurationAxis>sameTypeSeries.yAxis;
    } else {
      // Create a new axis
      yAxis = this.chart.yAxes.push(this.createYAxisForSeries(series.dummyData.stream.type));
      // yAxis.disabled = true; // Disable at start


      // yAxis.tooltip.disabled = true;
      // yAxis.interpolationDuration = 500;
      // yAxis.rangeChangeDuration = 500;
      yAxis.renderer.inside = false;
      yAxis.renderer.grid.template.disabled = !this.showGrid;
      yAxis.renderer.line.strokeOpacity = 1;

      if (this.stackYAxes) {
        yAxis.paddingLeft = 5;
        yAxis.renderer.inside = true;
        yAxis.layout = 'absolute';
        yAxis.renderer.line.align = 'right';
        yAxis.align = 'right';
        yAxis.marginTop = 30;
        // yAxis.marginBottom = 20;
        yAxis.title.valign = 'top';
        yAxis.title.align = 'left';
        yAxis.title.dx = 0;
        yAxis.title.dy = -20;
        yAxis.title.isMeasured = false;
        yAxis.title.parent = yAxis.renderer;
        yAxis.title.fontSize = '1.15em';
        yAxis.title.fontWeight = '600';
        yAxis.title.adapter.add('rotation', () => 0);

      } else {
        yAxis.renderer.labels.template.marginLeft = 10;
        yAxis.paddingLeft = 5;
        yAxis.paddingRight = 0;
        yAxis.layout = 'absolute';
        yAxis.align = 'left';
        yAxis.renderer.line.align = 'right';
        yAxis.title.valign = 'middle';
        yAxis.title.align = 'left';
        yAxis.title.fontSize = '1.05em';
        yAxis.title.fontWeight = '600';
      }

      yAxis.renderer.minLabelPosition = 0.05;
      yAxis.renderer.maxLabelPosition = 0.95;


      yAxis.renderer.ticks.template.disabled = false;
      yAxis.renderer.ticks.template.strokeOpacity = 1;
      yAxis.renderer.ticks.template.strokeWidth = 1;
      yAxis.renderer.ticks.template.length = 5;
      yAxis.renderer.minGridDistance = 15;

      // Data specifics setup
      if ([DataPace.type, DataGradeAdjustedPace.type, DataGradeAdjustedPaceMinutesPerMile.type, DataSwimPace.type, DataSwimPaceMinutesPer100Yard.type, DataPaceMinutesPerMile.type].indexOf(series.dummyData.stream.type) !== -1) {
        yAxis.renderer.inversed = true;
        yAxis.baseValue = Infinity;
        yAxis.extraMin = 0.0;
        // yAxis.max = 1800;
        // @todo this creates the issue
        yAxis.extraMax = this.extraMaxForPace;
        // yAxis.min = 0
        // yAxis.minY = 0;

        yAxis.renderer.labels.template.adapter.add('text', (text, target) => {
          if (target.dataItem && isNumber(target.dataItem['value']) && (target.dataItem['value'] < 0)) {
            return undefined;
          }
          return text;
        });
        // yAxis.strictMinMax = true;
        // yAxis.extraMax = 0.5
        // series.baseAxis = yAxis;
      } else {
        series.dummyData.stream.type === DataPower.type ? yAxis.extraMax = this.extraMaxForPower : yAxis.extraMax = 0.1;
      }
      yAxis.title.adapter.add('text', (text, target) => {
        if (!this.stackYAxes) {
          return `${series.name}`;
        }
        const map = {
          max: '',
          min: '',
          avg: ''
        };
        (<AxisRendererY>target.parent).axis.series.each((axisSeries, index) => {

          if (axisSeries.hidden) {
            return;
          }
          if (DynamicDataLoader.dataTypeMinDataType[axisSeries.dummyData.stream.type]) {
            map.min += `${axisSeries.dummyData.activity.getStat(DynamicDataLoader.dataTypeMinDataType[axisSeries.dummyData.stream.type]).getDisplayValue()}${axisSeries.dummyData.activity.getStat(DynamicDataLoader.dataTypeMinDataType[axisSeries.dummyData.stream.type]).getDisplayUnit()}`
          }
          if (DynamicDataLoader.dataTypeAvgDataType[axisSeries.dummyData.stream.type]) {
            map.avg += `${axisSeries.dummyData.activity.getStat(DynamicDataLoader.dataTypeAvgDataType[axisSeries.dummyData.stream.type]).getDisplayValue()}${axisSeries.dummyData.activity.getStat(DynamicDataLoader.dataTypeAvgDataType[axisSeries.dummyData.stream.type]).getDisplayUnit()}`
          }
          if (DynamicDataLoader.dataTypeMaxDataType[axisSeries.dummyData.stream.type]) {
            map.max += `${axisSeries.dummyData.activity.getStat(DynamicDataLoader.dataTypeMaxDataType[axisSeries.dummyData.stream.type]).getDisplayValue()}${axisSeries.dummyData.activity.getStat(DynamicDataLoader.dataTypeMinDataType[axisSeries.dummyData.stream.type]).getDisplayUnit()}`
          }
          if (index + 1 !== (<AxisRendererY>target.parent).axis.series.length) {
            map.min += `, `
            map.avg += `,  `
            map.max += `,  `
          }

        })
        return `[font-size: 0.9em]${series.name}[/] [bold font-size: 0.8em]Min:[/] [font-size: 0.7em]${map.min}[/] [bold font-size: 0.8em]Avg:[/] [font-size: 0.7em]${map.avg}[/] [bold font-size: 0.8em]Max:[/] [font-size: 0.7em]${map.max}[/]`
      });

      // Style axis tooltip for dark themes
      if (this.chartTheme === 'dark' || this.chartTheme === 'amchartsdark') {
        yAxis.tooltip.background.fill = this.core.color('#303030');
        yAxis.tooltip.background.stroke = this.core.color('#303030');
        yAxis.tooltip.label.fill = this.core.color('#ffffff');
      }

    }
    return yAxis;
  }

  private shouldHideSeries(series: XYSeries) {
    if (this.hideAllSeriesOnInit) {
      return true
    } else if (this.chartSettingsLocalStorageService.getSeriesIDsToShow(this.event).length) {
      const storedIDs = this.chartSettingsLocalStorageService.getSeriesIDsToShow(this.event);
      // Try to match exact or loose (ignoring the merge index suffix)
      // Suffix is usually _0, _1 etc. before the stream type (which starts with capital D for Data...)
      const normalize = (id: string) => id.replace(/_\d+(?=[A-Z])/, '');
      const normalizedSeriesID = normalize(series.id);
      const isVisible = storedIDs.indexOf(series.id) !== -1 || storedIDs.some(id => normalize(id) === normalizedSeriesID);
      if (!isVisible) {
        return true
      }
    } else {
      // Else try to check what we should show by default
      const activityType = (ActivityTypes as any)[series.dummyData.activity.type] !== undefined ? (ActivityTypes as any)[series.dummyData.activity.type] : series.dummyData.activity.type;
      const defaultTypes = [...AppUserService.getDefaultChartDataTypesToShowOnLoad(), ...ActivityTypesHelper.speedDerivedDataTypesToUseForActivityType(activityType)]
        .reduce((accu: string[], dataType) => {
          return [...accu, ...DynamicDataLoader.getUnitBasedDataTypesFromDataType(dataType, this.userUnitSettings)]
        }, []);

      if (defaultTypes.indexOf(series.dummyData.stream.type) === -1) {
        return true
      }
    }
  }

  private createRangeLabelsContainer(chart: am4charts.XYChart): am4core.Container {
    const rangeLabelsContainer = chart.chartContainer.createChild(this.core.Container);

    rangeLabelsContainer.id = 'rangeLabelsContainer';
    rangeLabelsContainer.isMeasured = false;
    rangeLabelsContainer.width = this.core.percent(100);
    rangeLabelsContainer.height = this.core.percent(100);
    rangeLabelsContainer.x = 50;
    rangeLabelsContainer.y = this.core.percent(90);

    rangeLabelsContainer.layout = 'horizontal';
    // rangeLabelsContainer.align = 'right';
    // rangeLabelsContainer.verticalCenter = 'rop';
    rangeLabelsContainer.zIndex = 100;
    this.rangeLabelsContainer = rangeLabelsContainer;
    return rangeLabelsContainer

  }

  private createLabel(container: am4core.Container | am4charts.Chart, series: am4charts.Series, labelData: LabelData, hidden: boolean = false): am4core.Label {
    const labelContainer = container.createChild(this.core.Container);

    labelContainer.id = this.getSeriesRangeLabelContainerID(series);
    labelContainer.background.fillOpacity = 0.6;
    labelContainer.background.fill = this.core.color('#000000');
    labelContainer.padding(12, 16, 12, 16);
    labelContainer.verticalCenter = 'bottom';
    labelContainer.background.stroke = <am4core.Color>series.stroke;
    labelContainer.background.strokeOpacity = 1;
    labelContainer.background.strokeWidth = 2;

    // Add Drop Shadow
    const shadow = new this.core.DropShadowFilter();
    shadow.dy = 4;
    shadow.dx = 0;
    shadow.opacity = 0.5;
    shadow.blur = 8;
    labelContainer.filters.push(shadow);

    const bg = <am4core.RoundedRectangle>labelContainer.background;
    bg.cornerRadiusTopLeft = 10;
    bg.cornerRadiusTopRight = 10;
    bg.cornerRadiusBottomRight = 10;
    bg.cornerRadiusBottomLeft = 10;
    labelContainer.zIndex = 100;

    const label = labelContainer.createChild(this.core.Label);
    label.align = 'center';

    const headerTextColor = this.core.color('#FFFFFF');
    const labelColor = this.core.color('#FFFFFF');
    // const valueColor = this.core.color('#FFFFFF'); // Bright white for values

    label.text = `
      [bold font-size: 1.2em ${headerTextColor}]${labelData.name}[/]\n
      ${this.event.getActivities().length !== 1 ? `[bold font-size: 1.0em ${headerTextColor}]${series.dummyData.activity.creator.name}[/]\n` : ``}
      [font-size: 1.0em opacity: 0.7 ${labelColor}]Avg:[/] [bold font-size: 1.1em ${headerTextColor}]${labelData.average.value}[/][opacity: 0.7 ${labelColor}]${labelData.average.unit}[/]\n
      [font-size: 1.0em opacity: 0.7 ${labelColor}]Max:[/] [bold font-size: 1.1em ${headerTextColor}]${labelData.max.value}[/][opacity: 0.7 ${labelColor}]${labelData.max.unit}[/]\n
      [font-size: 1.0em opacity: 0.7 ${labelColor}]Min:[/] [bold font-size: 1.1em ${headerTextColor}]${labelData.min.value}[/][opacity: 0.7 ${labelColor}]${labelData.min.unit}[/]\n
      [font-size: 1.0em opacity: 0.7 ${labelColor}]Diff:[/] [bold font-size: 1.1em ${headerTextColor}]${labelData.minToMaxDiff === undefined ? '--' : labelData.minToMaxDiff.value}[/][opacity: 0.7 ${labelColor}]${labelData.minToMaxDiff === undefined ? '' : labelData.minToMaxDiff.unit}[/]\n
      [font-size: 1.0em opacity: 0.7 ${labelColor}]Gain:[/] [bold font-size: 1.1em ${headerTextColor}]${labelData.gain === undefined ? '--' : labelData.gain.value}[/][opacity: 0.7 ${labelColor}]${labelData.gain === undefined ? '' : labelData.gain.unit}[/]\n
      [font-size: 1.0em opacity: 0.7 ${labelColor}]Loss:[/] [bold font-size: 1.1em ${headerTextColor}]${labelData.loss === undefined ? '--' : labelData.loss.value}[/][opacity: 0.7 ${labelColor}]${labelData.loss === undefined ? '' : labelData.loss.unit}[/]\n
      [font-size: 1.0em opacity: 0.7 ${labelColor}]Gradient:[/] [bold font-size: 1.1em ${headerTextColor}]${labelData.slopePercentage === undefined ? '--' : labelData.slopePercentage.value}[/][opacity: 0.7 ${labelColor}]${labelData.slopePercentage === undefined ? '' : '%'}[/]\n
      `;

    labelContainer.disabled = hidden;
    return label;
  }

  private addZoomOrSelectButton(chart: am4charts.XYChart): am4core.Button {
    const button = chart.plotContainer.createChild(this.core.Button);

    button.id = 'zoomOrSelectButton';
    button.label.text = chart.cursor.behavior === 'selectX' ? ' Selecting' : ' Zooming';
    button.padding(12, 12, 12, 12);
    // button.width = 20;
    button.fontSize = '1.1em';
    button.align = 'right';
    // button.y = -2;
    // button.dx = -68;
    button.opacity = 0.8;
    // button.icon = new am4core.Sprite();
    // button.icon.path = chart.cursor.behavior === ChartCursorBehaviours.SelectX ?
    //   'm3 5h2v-2c-1.1 0-2 .9-2 2zm0 8h2v-2h-2zm4 8h2v-2h-2zm-4-12h2v-2h-2zm10-6h-2v2h2zm6 0v2h2c0-1.1-.9-2-2-2zm-14 18v-2h-2c0 1.1.9 2 2 2zm-2-4h2v-2h-2zm6-14h-2v2h2zm2 18h2v-2h-2zm8-8h2v-2h-2zm0 8c1.1 0 2-.9 2-2h-2zm0-12h2v-2h-2zm0 8h2v-2h-2zm-4 4h2v-2h-2zm0-16h2v-2h-2zm-8 12h10v-10h-10zm2-8h6v6h-6z"'
    //   : 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z';
    // button.icon.marginRight = 10;
    button.zIndex = 20;
    button.events.on('hit', (ev) => {
      chart.cursor.behavior = chart.cursor.behavior === ChartCursorBehaviours.SelectX ? ChartCursorBehaviours.ZoomX : ChartCursorBehaviours.SelectX;
      ev.target.label.text = chart.cursor.behavior === ChartCursorBehaviours.SelectX ? 'Selecting' : 'Zooming';
    });
    return button;
  }

  private addClearSelectionButton(chart: am4charts.XYChart): am4core.Button {
    const button = chart.plotContainer.createChild(this.core.Button);

    button.id = 'clearSelectionButton';
    // button.label.text = 'Clear';
    button.padding(12, 12, 12, 12);
    button.y = 60;
    button.dx = -0;
    button.fontSize = '1.0em';
    button.align = 'right';
    // button.marginLeft = 25;
    button.zIndex = 30;
    button.opacity = 0.8;
    button.icon = new this.core.Sprite();
    button.icon.path = 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';



    button.events.on('hit', (ev) => {
      this.disposeRangeLabelsContainer(chart);
      this.disposeCursorSelection(chart);
      this.disposeClearSelectionButton(chart);
    });
    this.clearSelectionButton = button;
    return button;
  }

  // @todo

  // @todo take a good look at getStreamDataTypesBasedOnDataType on utilities for an already existing implementation
  private convertStreamDataToSeriesData(activity: ActivityInterface, stream: StreamInterface): any {

    let data = [];
    //
    if (this.xAxisType === XAxisTypes.Distance && this.distanceAxesForActivitiesMap.get(activity.getID())) {
      const distanceStream = this.distanceAxesForActivitiesMap.get(activity.getID());
      distanceStream.getData().reduce((dataMap, distanceStreamDataItem, index) => { // Can use a data array but needs deduplex after
        if (isNumber(stream.getData()[index]) && stream.getData()[index] !== Infinity && isNumber(distanceStreamDataItem)) {
          // debugger;
          dataMap.set(distanceStreamDataItem, stream.getData()[index]) // Here it could be improved with finding the nearby perhaps but not sure
        }
        return dataMap;
      }, new Map<number, number>()).forEach((value, distance) => {
        data.push({
          axisValue: distance,
          value: value
        }) // @todo if needed sort here by distance
      });
    } else {
      data = this.xAxisType === XAxisTypes.Time ? stream.getStreamDataByTime(activity.startDate, true, true) : stream.getStreamDataByDuration(0, true, true); // Keep zero base for duration
    }

    // filter if needed (this operation costs)
    const samplingRate = this.getSamplingRateInSeconds(this.selectedActivities);


    if (samplingRate !== 1) {
      data = data.filter((streamData, index) => (index % samplingRate) === 0);
    }

    return data;
  }

  private getSamplingRateInSeconds(activities: ActivityInterface[]): number {
    if (this.downSamplingLevel === 1) {
      return 1;
    }
    // Rate is minimum 1
    const rate = this.downSamplingLevel || 1;
    // If we do not need to strengthen the downsampling based on the DOWNSAMPLE_AFTER_X_HOURS
    // then we just need to return the sampling rate the user has selected
    if (this.getActivitiesHours(activities) < DOWNSAMPLE_AFTER_X_HOURS) {
      return 1;
    }
    // If the activity needs a bump on downsampling > DOWNSAMPLE_AFTER_X_HOURS
    return rate * Math.ceil(Math.ceil(this.getActivitiesHours(activities) / DOWNSAMPLE_AFTER_X_HOURS) * DOWNSAMPLE_FACTOR_PER_HOUR);
  }

  private getActivitiesHours(activities: ActivityInterface[]): number {
    return activities.reduce((duration, activity) => {
      duration += Math.ceil((activity.getDuration().getValue() / (60 * 60)));
      return duration
    }, 0);
  }

  private getActivityHours(activity: ActivityInterface): number {
    return Math.ceil((activity.getDuration().getValue() / (60 * 60)));
  }

  private addDataToChart(data: any) {
    this.zone.runOutsideAngular(() => {
      this.chart.data = data;
    });
  }

  private addDataToSeries(series: am4charts.LineSeries, data: any) {
    this.zone.runOutsideAngular(() => {
      series.data = data;
    });
  }

  private getSeriesRangeLabelContainer(series): am4core.Container | null {
    if (!this.rangeLabelsContainer) {
      return null;
    }
    return <am4core.Container>this.rangeLabelsContainer.children.values.find(child => child.id === this.getSeriesRangeLabelContainerID(series));
  }

  private getSeriesIDFromActivityAndStream(activity, stream): string {
    return `${activity.getID()}${stream.type}`;
  }

  private getSeriesRangeLabelContainerID(series): string {
    return `rangeLabelContainer${series.id}`;
  }

  private addLapGuides(chart: am4charts.XYChart, selectedActivities: ActivityInterface[], xAxisType: XAxisTypes, lapTypes: LapTypes[]) {
    const xAxis = <am4charts.ValueAxis | am4charts.DateAxis>chart.xAxes.getIndex(0);
    xAxis.axisRanges.template.grid.disabled = false;
    selectedActivities
      .forEach((activity, activityIndex) => {
        // Filter on lapTypes
        lapTypes
          .forEach(lapType => {
            activity
              .getLaps()
              .filter(lap => lap.type === lapType)
              .forEach((lap, lapIndex) => {
                if (lapIndex === activity.getLaps().length - 1) {
                  return;
                }
                let range
                if (xAxisType === XAxisTypes.Time) {
                  range = xAxis.axisRanges.create();
                  range.value = lap.endDate.getTime();
                } else if (xAxisType === XAxisTypes.Duration) {
                  range = xAxis.axisRanges.create();
                  range.value = +lap.endDate - +activity.startDate;
                } else if (xAxisType === XAxisTypes.Distance && this.distanceAxesForActivitiesMap.get(activity.getID())) {
                  const data = this.distanceAxesForActivitiesMap
                    .get(activity.getID())
                    .getStreamDataByTime(activity.startDate, true)
                    .filter(streamData => streamData && (streamData.time >= lap.endDate.getTime()));
                  // There can be a case that the distance stream does not have data for this?
                  // So if there is a lap, done and the watch did not update the distance example: last 2s lap
                  if (!data[0]) {
                    return;
                  }
                  range = xAxis.axisRanges.create();
                  range.value = data[0].value;
                }
                range.grid.stroke = this.core.color(this.eventColorService.getActivityColor(this.event.getActivities(), activity));

                range.grid.strokeWidth = 1.1;
                range.grid.strokeOpacity = 1;
                range.grid.strokeDasharray = '2,5';

                range.grid.above = true;
                range.grid.zIndex = 1;
                range.grid.tooltipText = `[${this.core.color(this.eventColorService.getActivityColor(this.event.getActivities(), activity)).toString()} bold font-size: 1.2em]${activity.creator.name}[/]\n[bold font-size: 1.0em]Lap #${lapIndex + 1}[/]\n[bold font-size: 1.0em]Type:[/] [font-size: 0.8em]${lapType}[/]`;
                range.grid.tooltipPosition = 'pointer';

                range.label.tooltipText = range.grid.tooltipText;
                range.label.inside = true;
                range.label.adapter.add('text', () => {
                  return `${lapIndex + 1}`;
                });
                range.label.paddingTop = 2;
                range.label.paddingBottom = 2;
                range.label.zIndex = 11;
                range.label.fontSize = '1em';
                range.label.background.fillOpacity = 1;
                range.label.background.stroke = range.grid.stroke;
                range.label.background.strokeWidth = 1;
                range.label.tooltipText = range.grid.tooltipText;

                // range.label.interactionsEnabled = true;

                range.label.background.width = 1;
                range.label.fill = range.grid.stroke;
                range.label.horizontalCenter = 'middle';
                range.label.valign = 'bottom';
                range.label.textAlign = 'middle';
                range.label.dy = 6;
              }
              )
          });
      })
  }

  private addStartPauseSeriesRanges(chart: am4charts.XYChart, xAxisType: XAxisTypes, series: am4charts.XYSeries[]) {
    // const xAxis = <am4charts.ValueAxis>chart.yAxes.getIndex(0);
    // xAxis.axisRanges.template.grid.disabled = false;

    series
      .forEach((serie, seriesIndex) => {
        const activity = serie.dummyData.activity;
        const stopEvents = activity.getStopEvents();
        const stopAllEvents = activity.getStopAllEvents();
        activity.getStartEvents().forEach((startEvent, startEventIndex) => {
          if (startEventIndex === 0) {
            return;
          }
          let range;
          let stopEvent;
          // See https://github.com/amcharts/amcharts4/issues/2574#issuecomment-642635857
          if (!(<am4charts.ValueAxis>serie.yAxis).adapter.isEnabled('baseValue')) {
            (<am4charts.ValueAxis>serie.yAxis).adapter.add('baseValue', function (baseValue, target) {
              return baseValue === Infinity ? target.maxZoomed : target.minZoomed;
            })
          }
          stopEvent = stopEvents[startEventIndex - 1] ? stopEvents[startEventIndex - 1] : stopAllEvents[startEventIndex - 1];
          if (!stopEvent) {
            return;
          }
          range = serie.xAxis.createSeriesRange(serie);
          range.date = new Date(activity.startDate.getTime() + stopEvent.getValue() * 1000);
          range.endDate = new Date(activity.startDate.getTime() + startEvent.getValue() * 1000)
          range.contents.stroke = this.core.color('#969393');

          range.contents.strokeWidth = this.strokeWidth;
          range.contents.strokeOpacity = this.strokeOpacity;
          range.grid.above = true;
          // range.contents.fill = am4core.color('#DEDEDE');
          // range.contents.fill = am4core.color('#DEDEDE');
          range.contents.fillOpacity = 0.0;
        })
      });
  }

  private addStartPauseTimeAxisRanges(axis: am4charts.DateAxis) {
    // const xAxis = <am4charts.ValueAxis>chart.yAxes.getIndex(0);
    // xAxis.axisRanges.template.grid.disabled = false;

    this.selectedActivities
      .forEach((activity, seriesIndex) => {
        const stopEvents = activity.getStopEvents();
        const stopAllEvents = activity.getStopAllEvents();
        activity.getStartEvents().forEach((startEvent, startEventIndex) => {
          if (startEventIndex === 0) {
            return;
          }
          let stopEvent;
          stopEvent = stopEvents[startEventIndex - 1] ? stopEvents[startEventIndex - 1] : stopAllEvents[startEventIndex - 1];
          if (!stopEvent) {
            return;
          }
          const range = axis.axisRanges.create();
          range.date = new Date(activity.startDate.getTime() + stopEvent.getValue() * 1000);
          range.endDate = new Date(activity.startDate.getTime() + startEvent.getValue() * 1000)
          range.axisFill.fill = this.core.color(AppColors.MediumGray);

          range.axisFill.fillOpacity = 0.2;
          range.grid.strokeOpacity = 0;
          range.grid.above = true;
          range.tick.disabled = true;

        })
      });
  }

  private removeLapGuides(chart: am4charts.XYChart) {
    chart.xAxes.getIndex(0).axisRanges.clear();
  }

  private removeGrid() {
    this.chart.xAxes.each(axis => axis.renderer.grid.template.disabled = true);
    this.chart.yAxes.each(axis => axis.renderer.grid.template.disabled = true);
  }

  private addGrid() {
    this.chart.xAxes.each(axis => axis.renderer.grid.template.disabled = false);
    this.chart.yAxes.each(axis => axis.renderer.grid.template.disabled = false);
  }

  private getSeriesColor(series: am4charts.XYSeries) {

    if (this.getSameNameSeries(series).length < 2 || this.selectedActivities.length === 1) {
      return AppDataColors[series.name] || this.getFillColor(series.chart, series.chart.series.indexOf(series));
    }
    return AppDataColors[`${series.name}_${this.getSameNameSeries(series).indexOf(series)}`] || this.getFillColor(series.chart, series.chart.series.indexOf(series));
  }

  private unSubscribeFromAll() {
    this.getSubscriptions().forEach(subscription => subscription.unsubscribe());

  }

  private addXAxis(chart: am4charts.XYChart, xAxisType: XAxisTypes): am4charts.ValueAxis | am4charts.DateAxis {
    let xAxis;
    switch (xAxisType) {
      case XAxisTypes.Distance:
        xAxis = chart.xAxes.push(new this.charts.ValueAxis());
        xAxis.extraMax = 0.05; // Give more breathing room

        xAxis.renderer.minGridDistance = 40;
        // xAxis.strictMinMax = true; // Can prevent auto-scaling with incremental data

        xAxis.numberFormatter = new this.core.NumberFormatter();
        xAxis.numberFormatter.numberFormat = `#`;

        // valueAxis.numberFormatter.numberFormat = `#${DynamicDataLoader.getDataClassFromDataType(this.chartDataType).unit}`;
        xAxis.renderer.labels.template.adapter.add('text', (text, target) => {
          if (!target.dataItem.value) {
            return '';
          }
          const data = DynamicDataLoader.getDataInstanceFromDataType(DataDistance.type, target.dataItem.value);
          return `[bold font-size: 1.0em]${data.getDisplayValue()}[/]${data.getDisplayUnit()}[/]`
        });
        // xAxis.tooltipText = '{valueX}'
        xAxis.adapter.add('getTooltipText', (text, target) => {
          const data = DynamicDataLoader.getDataInstanceFromDataType(DataDistance.type, Number(text));
          return `[bold font-size: 1.0em]${data.getDisplayValue()}[/]${data.getDisplayUnit()}[/]`
        });
        // xAxis.renderer.labels.template.marginRight = 10;
        xAxis.min = 0;
        break;
      case XAxisTypes.Duration:
      case XAxisTypes.Time:
        xAxis = chart.xAxes.push(new this.charts.DateAxis());
        xAxis.baseInterval = { timeUnit: 'second', count: 1 };
        if (xAxisType === XAxisTypes.Duration) {
          xAxis.extraMax = 0.01; // Give a tiny bit of breathing room
        }

        if (!this.disableGrouping) {
          // this is true pixels
          // const screenPixes = Math.max(...[this.windowService.windowRef.screen.width, this.windowService.windowRef.screen.height]) * this.windowService.windowRef.devicePixelRatio;
          // This is with no retina etc
          // We use no retina for performance for now
          const screenPixes = Math.max(...[this.windowService.windowRef.screen.width, this.windowService.windowRef.screen.height]);

          xAxis.groupData = true;
          // xAxis.groupCount = 60 * 60 * GROUP_ON_X_HOURS;
          xAxis.groupCount = screenPixes
        }
        break;
      default:
        throw new Error(`Not implemented for ${xAxisType}`)
    }

    xAxis.title.text = this.xAxisType;
    xAxis.title.fontSize = '1.0em';
    xAxis.title.fontWeight = '600';
    // xAxis.renderer.grid.template.disabled = this.addGrid === false;
    xAxis.renderer.line.strokeOpacity = 1;
    xAxis.renderer.line.strokeWidth = 1;

    xAxis.renderer.grid.template.disabled = !this.showGrid;

    xAxis.renderer.ticks.template.disabled = false;
    xAxis.renderer.ticks.template.strokeOpacity = 1;
    xAxis.renderer.ticks.template.strokeWidth = 1;
    xAxis.renderer.ticks.template.length = 10;
    xAxis.renderer.minGridDistance = 50;

    // valueAxis.renderer.minGridDistance = this.vertical ?  0 : 200;

    xAxis.padding = 0;
    // xAxis.renderer.labels.template.fontSize = '1.2em';

    // Style axis tooltip for dark themes
    if (this.chartTheme === 'dark' || this.chartTheme === 'amchartsdark') {
      xAxis.tooltip.background.fill = this.core.color('#303030');
      xAxis.tooltip.background.stroke = this.core.color('#303030');
      xAxis.tooltip.label.fill = this.core.color('#ffffff');
    }

    return xAxis;
  }

  private attachChartLegendToChart(chart) {
    return this.zone.runOutsideAngular(() => {
      // Create a Legend
      chart.legend = new this.charts.Legend();
      // legend.fontSize = '1em';

      chart.legend.parent = this.core.create(this.legendDiv.nativeElement, this.core.Container);

      chart.legend.parent.width = this.core.percent(100);
      chart.legend.parent.height = this.core.percent(100);

      chart.legend.useDefaultMarker = true;
      const marker = <am4core.RoundedRectangle>chart.legend.markers.template.children.getIndex(0);
      marker.cornerRadius(14, 14, 14, 14);
      marker.strokeWidth = 4;
      marker.strokeOpacity = 1;
      marker.stroke = this.core.color('#0a97ee');

    });

  }

  private destroyLegendParent() {
    return this.zone.runOutsideAngular(() => {
      if (this.chart && this.chart.legend && this.chart.legend.parent) {
        this.chart.legend.parent.dispose();
      }
    });
  }

  private handleCursorPositionChange(event: any) {
    if (!event || !event.target || !event.target.chart) {
      return;
    }

    // Avoid rewriting cursor change if it's triggered from this component
    if (event.target['_stick'] === 'hard') {
      event.target.triggerMove(event.target.point, 'soft');
      return;
    }

    event.target.triggerMove(event.target.point, 'soft');
    let xAxis;
    switch (this.xAxisType) {
      case XAxisTypes.Time:
        xAxis = <am4charts.DateAxis>event.target.chart.xAxes.getIndex(0);
        if (xAxis.positionToDate) {
          const date = xAxis.positionToDate(xAxis.pointToPosition(event.target.point));
          if (date) {
            this.selectedActivities.forEach(activity => this.activityCursorService.setCursor({
              activityID: activity.getID(),
              time: date.getTime(),
              byChart: true,
            }));
          }
        }
        break;
      case XAxisTypes.Duration:
        xAxis = <am4charts.DateAxis>event.target.chart.xAxes.getIndex(0);
        if (xAxis.positionToDate) {
          const date = xAxis.positionToDate(xAxis.pointToPosition(event.target.point));
          if (date) {
            this.selectedActivities.forEach(activity => this.activityCursorService.setCursor({
              activityID: activity.getID(),
              time: date.getTime() + activity.startDate.getTime(),
              byChart: true,
            }));
          }
        }
        break;
      case XAxisTypes.Distance:
        xAxis = <am4charts.ValueAxis>event.target.chart.xAxes.getIndex(0);
        if (xAxis.positionToValue) {
          const distance = xAxis.positionToValue(xAxis.pointToPosition(event.target.point));
          this.selectedActivities.forEach(activity => {
            const distanceStream = activity.getStream(DataDistance.type);
            if (distanceStream) {
              const distances = distanceStream.getData();
              if (!distances || distances.length === 0) {
                return;
              }

              // Binary search for closest index
              let low = 0, high = distances.length - 1;
              let index = -1;
              while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                if (distances[mid] === distance) {
                  index = mid;
                  break;
                } else if (distances[mid] < distance) {
                  low = mid + 1;
                } else {
                  high = mid - 1;
                }
              }

              // If pure binary search didn't Hit, find closest
              if (index === -1) {
                if (high < 0) index = 0;
                else if (low >= distances.length) index = distances.length - 1;
                else index = (Math.abs(distance - distances[high]) < Math.abs(distances[low] - distance)) ? high : low;
              }

              if (index !== -1) {
                let timeStream;
                // check for Time stream first
                // Time stream is guaranteed by AppEventService enrichment
                timeStream = activity.getStream(XAxisTypes.Time);

                const timeData = timeStream.getData();
                if (timeData && timeData[index] !== undefined && timeData[index] !== null) {
                  const timeOffset = timeData[index];
                  // Assuming timeOffset is in seconds (standard for Duration/Time streams in this app)
                  this.activityCursorService.setCursor({
                    activityID: activity.getID(),
                    time: activity.startDate.getTime() + (timeOffset * 1000),
                    byChart: true,
                  });
                }
              }
            }
          });
        }
        break;
    }
  }
}
