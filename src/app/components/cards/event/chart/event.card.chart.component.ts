import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component, HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit, SimpleChanges,
} from '@angular/core';
import {Log} from 'ng2-logger/browser'
import {EventColorService} from '../../../../services/color/app.event.color.service';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import {combineLatest, Subscription} from 'rxjs';
import {EventService} from '../../../../services/app.event.service';
import {DataAltitude} from 'quantified-self-lib/lib/data/data.altitude';
import {map, take} from 'rxjs/operators';
import {StreamInterface} from 'quantified-self-lib/lib/streams/stream.interface';
import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {DataPace, DataPaceMinutesPerMile} from 'quantified-self-lib/lib/data/data.pace';
import {
  ChartCursorBehaviours,
  XAxisTypes
} from 'quantified-self-lib/lib/users/user.chart.settings.interface';
import {UserUnitSettingsInterface} from 'quantified-self-lib/lib/users/user.unit.settings.interface';
import {EventUtilities} from 'quantified-self-lib/lib/events/utilities/event.utilities';
import {ChartAbstract} from '../../../charts/chart.abstract';
import {DataDistance} from 'quantified-self-lib/lib/data/data.distance';
import {isNumber} from 'quantified-self-lib/lib/events/utilities/helpers';
import {ActivityTypes, ActivityTypesHelper} from 'quantified-self-lib/lib/activities/activity.types';
import {DataSwimPace, DataSwimPaceMinutesPer100Yard} from 'quantified-self-lib/lib/data/data.swim-pace';
import {DataSwimPaceMaxMinutesPer100Yard} from 'quantified-self-lib/lib/data/data.swim-pace-max';
import {DataGPSAltitude} from 'quantified-self-lib/lib/data/data.altitude-gps';
import {DataAccumulatedPower} from 'quantified-self-lib/lib/data/data.accumulated-power';
import {DataTemperature} from 'quantified-self-lib/lib/data/data.temperature';
import {
  DataSpeed,
  DataSpeedFeetPerMinute,
  DataSpeedFeetPerSecond, DataSpeedKilometersPerHour,
  DataSpeedMetersPerMinute, DataSpeedMilesPerHour
} from 'quantified-self-lib/lib/data/data.speed';
import {LapTypes} from 'quantified-self-lib/lib/laps/lap.types';
import {AppDataColors} from '../../../../services/color/app.data.colors';
import {WindowService} from '../../../../services/app.window.service';
import {DataStrydSpeed} from 'quantified-self-lib/lib/data/data.stryd-speed';
import {
  DataVerticalSpeed, DataVerticalSpeedFeetPerHour, DataVerticalSpeedFeetPerMinute,
  DataVerticalSpeedFeetPerSecond, DataVerticalSpeedKilometerPerHour, DataVerticalSpeedMetersPerHour,
  DataVerticalSpeedMetersPerMinute, DataVerticalSpeedMilesPerHour
} from 'quantified-self-lib/lib/data/data.vertical-speed';
import {DataPower} from 'quantified-self-lib/lib/data/data.power';
import {DataPowerRight} from 'quantified-self-lib/lib/data/data.power-right';
import {DataPowerLeft} from 'quantified-self-lib/lib/data/data.power-left';
import {DataLeftBalance} from 'quantified-self-lib/lib/data/data.left-balance';
import {DataRightBalance} from 'quantified-self-lib/lib/data/data.right-balance';
import {DataStrydDistance} from 'quantified-self-lib/lib/data/data.stryd-distance';
import {DataEHPE} from 'quantified-self-lib/lib/data/data.ehpe';
import {DataSeaLevelPressure} from 'quantified-self-lib/lib/data/data.sea-level-pressure';
import {DataStrydAltitude} from 'quantified-self-lib/lib/data/data.stryd-altitude';
import {DataEVPE} from 'quantified-self-lib/lib/data/data.evpe';
import {DataAbsolutePressure} from 'quantified-self-lib/lib/data/data.absolute-pressure';
import {ChartHelper, LabelData} from './chart-helper';
import * as am4plugins_annotation from '@amcharts/amcharts4/plugins/annotation';
import {DataAirPower} from 'quantified-self-lib/lib/data/data.air-power';
import {UserService} from '../../../../services/app.user.service';
import {ChartSettingsLocalStorageService} from '../../../../services/storage/app.chart.settings.local.storage.service';
import {User} from 'quantified-self-lib/lib/users/user';

const DOWNSAMPLE_AFTER_X_HOURS = 10;
const DOWNSAMPLE_FACTOR_PER_HOUR = 1; // @todo should be per 10 hours

@Component({
  selector: 'app-event-card-chart',
  templateUrl: './event.card.chart.component.html',
  styleUrls: ['./event.card.chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventCardChartComponent extends ChartAbstract implements OnChanges, OnInit, OnDestroy, AfterViewInit {

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
  @Input() dataTypesToUse: string[];


  public distanceAxesForActivitiesMap = new Map<string, StreamInterface>();
  public isLoading: boolean;

  private streamsSubscription: Subscription;
  protected chart: am4charts.XYChart;
  protected logger = Log.create('EventCardChartComponent');

  constructor(changeDetector: ChangeDetectorRef,
              protected zone: NgZone,
              private windowService: WindowService,
              private eventService: EventService,
              private chartSettingsLocalStorageService: ChartSettingsLocalStorageService,
              private eventColorService: EventColorService) {
    super(zone, changeDetector);
  }

  async ngAfterViewInit() {
    this.logger.info(`ViewInit`);
    this.chart = this.createChart();
    await this.processChanges();
    // this.chart = this.createChart();
  }

  async ngOnInit() {
    this.logger.info(`Init`);
    if (!this.targetUserID || !this.event) {
      throw new Error('Component needs events and users');
    }
  }

  async ngOnChanges(simpleChanges: SimpleChanges) {
    this.logger.info(`Change`);

    if (this.chart && (simpleChanges.chartTheme || simpleChanges.xAxisType || simpleChanges.stackYAxes || simpleChanges.chartCursorBehaviour || simpleChanges.disableGrouping)) {
      this.destroyChart();
      this.chart = this.createChart();
    }

    if (simpleChanges.event
      || simpleChanges.selectedActivities
      || simpleChanges.showAllData
      || simpleChanges.showLaps
      || simpleChanges.lapTypes
      || simpleChanges.showGrid
      || simpleChanges.stackYAxes
      || simpleChanges.extraMaxForPower
      || simpleChanges.hideAllSeriesOnInit
      || simpleChanges.strokeWidth
      || simpleChanges.fillOpacity
      || simpleChanges.dataTypesToUse
      || simpleChanges.downSamplingLevel
      || simpleChanges.gainAndLossThreshold) {
      if (!this.chart) {
        return;
      }
      this.unsubscribeAndClearChart();
      if (!this.event || !this.selectedActivities.length) {
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

      await this.processChanges();
      return;
    }

  }

  private async processChanges() {
    this.loading();
    // Important for performance / or not?
    // This is / will be needed when more performance needs to be achieved
    // Leaving this here for the future. For now the groups of data do suffice and do it better
    if (this.xAxisType === XAxisTypes.Distance) {
      for (const selectedActivity of this.selectedActivities) {
        this.distanceAxesForActivitiesMap.set(
          selectedActivity.getID(),
          (await this.eventService.getStreamsByTypes(this.targetUserID, this.event.getID(), selectedActivity.getID(), [DataDistance.type]).pipe(take(1)).toPromise())[0]
        );
      }
    }
    this.streamsSubscription = combineLatest(this.selectedActivities.map((activity) => {
      const allOrSomeSubscription = this.eventService.getStreamsByTypes(this.targetUserID, this.event.getID(), activity.getID(),
        this.getDataTypesToRequest(), //
      );
      return allOrSomeSubscription.pipe(map((streams) => {
        if (!streams.length) {
          return [];
        }
        // @todo create whitelist for unitstreams and not generate all and then remove ...
        // We get the unit streams and we filter on them based on the user pref
        const unitStreams = EventUtilities.getUnitStreamsFromStreams(streams).filter(stream => {
          return DynamicDataLoader.getUnitBasedDataTypesFromDataTypes(streams.map(st => st.type), this.userUnitSettings).indexOf(stream.type) !== -1;
        });
        return unitStreams.concat(streams).filter((stream) => {
          // Filter out pace if swimming
          if ([ActivityTypes.Swimming, ActivityTypes['Open water swimming']].indexOf(activity.type) !== -1) {
            return [DataPace.type, DataPaceMinutesPerMile.type].indexOf(stream.type) === -1;
          }
          return [DataSwimPace.type, DataSwimPaceMinutesPer100Yard.type].indexOf(stream.type) === -1;
        }).map((stream) => {
          return this.createOrUpdateChartSeries(activity, stream);
        });
      }))
    })).pipe(map((seriesArrayOfArrays) => {
      // Format flatten the arrays as they come in [[], []]
      return seriesArrayOfArrays.reduce((accu: [], item: []): am4charts.XYSeries[] => accu.concat(item), [])
    })).subscribe((series: am4charts.LineSeries[]) => {

      // this.logger.info(`Rendering chart data per series`);
      // series.forEach((currentSeries) => this.addDataToSeries(currentSeries, currentSeries.dummyData));
      this.logger.info(`Data Injected`);
      this.loaded();
      // this.chart.xAxes.getIndex(0).title.text = this.xAxisType;
      // After you have all the info adjust the axis if needed
      // if (this.xAxisType === XAxisTypes.Distance){
      //   (<am4charts.ValueAxis>this.chart.xAxes.getIndex(0)).max = this.distanceAxesForActivitiesMap.values(() =>{
      //   debugger;
      // })
      //   this.chart.xAxes.getIndex(0).strictMinMax = true;
      // }
    });
  }

  protected setupChart(chart: am4charts.XYChart) {

  }

  protected createChart(): am4charts.XYChart {
    const chart = <am4charts.XYChart>super.createChart(am4charts.XYChart);
    chart.fontSize = '1em';
    chart.padding(0, 10, 0, 0);
    // chart.resizable = false;

    // Add scrollbar
    chart.scrollbarX = new am4core.Scrollbar();
    chart.scrollbarX.startGrip.disabled = true;
    chart.scrollbarX.endGrip.disabled = true;
    chart.scrollbarX.marginTop = 0;

    if (this.stackYAxes) {
      ChartHelper.setYAxesToStack(chart);
    } else {
      ChartHelper.unsetYAxesToStack(chart);
    }

    chart.xAxes.push(this.addXAxis(chart, this.xAxisType));

    // Create a Legend
    this.attachChartLegendToChart(chart);
    // Create a cursor
    chart.cursor = new am4charts.XYCursor();

    chart.cursor.interactions.hitOptions.hitTolerance = 10;

    chart.cursor.behavior = this.chartCursorBehaviour;
    chart.cursor.zIndex = 10;
    chart.cursor.hideSeriesTooltipsOnSelection = true;
    // Sticky
    // chart.cursor.events.on('cursorpositionchanged', (event) => {
    //   chart.cursor.triggerMove(event.target.point, 'soft');
    // });
    // On select
    chart.cursor.events.on('selectended', (ev) => {
      const range = ev.target.xRange;
      this.disposeRangeLabelsContainer(ev.target.chart);
      this.disposeClearSelectionButton(ev.target.chart);
      // Noop if there is no selection its a click so just clear?
      if (!range) {
        return;
      }
      this.addClearSelectionButton(ev.target.chart);

      const rangeLabelsContainer = this.createRangeLabelsContainer(ev.target.chart);
      const axis = ev.target.chart.xAxes.getIndex(0);
      let start;
      let end;
      switch (this.xAxisType) {
        case XAxisTypes.Time:
          start = (<am4charts.DateAxis>axis).positionToDate(axis.toAxisPosition(range.start));
          end = (<am4charts.DateAxis>axis).positionToDate(axis.toAxisPosition(range.end));
          break;
        case XAxisTypes.Duration:
          start = (<am4charts.DateAxis>axis).positionToDate(axis.toAxisPosition(range.start));
          end = (<am4charts.DateAxis>axis).positionToDate(axis.toAxisPosition(range.end));
          break;
        default:
          start = (<am4charts.ValueAxis>axis).positionToValue(axis.toAxisPosition(range.start));
          end = (<am4charts.ValueAxis>axis).positionToValue(axis.toAxisPosition(range.end));
          break;
      }

      // alert('Selected start ' + start + ' end ' + end);
      // Now since we know the actual start end we need end iterate over the visible series and calculate AVG, Max,Min, Gain and loss not an easy job I suppose
      this.chart.series.values.forEach(series => {
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
            value: data.length ? `${<string>DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getAverage(data)).getDisplayValue()}` : '--',
            unit: `${<string>DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getAverage(data)).getDisplayUnit()}`
          },
          max: {
            value: data.length ? `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getMax(data)).getDisplayValue()}` : '--',
            unit: `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getMax(data)).getDisplayUnit()}`
          },
          min: {
            value: data.length ? `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getMin(data)).getDisplayValue()}` : '--',
            unit: `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getMin(data)).getDisplayUnit()}`
          },
          minToMaxDiff: {
            value: data.length ? `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getMax(data) - EventUtilities.getMin(data)).getDisplayValue()}` : '--',
            unit: `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getMax(data) - EventUtilities.getMin(data)).getDisplayUnit()}`
          }
        };
        if (this.doesDataTypeSupportGainOrLoss(series.dummyData.stream.type)) {
          labelData.gain = {
            value: data.length ? `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getGainOrLoss(data, true, this.gainAndLossThreshold)).getDisplayValue()}` : '--',
            unit: `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getGainOrLoss(data, true, this.gainAndLossThreshold)).getDisplayUnit()}`
          };
          labelData.loss = {
            value: data.length ? `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getGainOrLoss(data, false, this.gainAndLossThreshold)).getDisplayValue()}` : '--',
            unit: `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getGainOrLoss(data, false, this.gainAndLossThreshold)).getDisplayUnit()}`
          };
        }
        if (this.doesDataTypeSupportSlope(series.dummyData.stream.type) && this.xAxisType === XAxisTypes.Distance) {
          labelData.slopePercentage = {
            value: data.length ? `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, (EventUtilities.getMax(data) - EventUtilities.getMin(data)) / (end - start) * 100).getDisplayValue()}` : '--',
            unit: `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, (EventUtilities.getMax(data) - EventUtilities.getMin(data)) / (end - start) * 100).getDisplayUnit()}`
          };
        }
        // Todo should group pace and derived units
        // Should use dynamic data loader
        this.createLabel(rangeLabelsContainer, series, labelData, series.hidden)
      });

    });

    // Add zoom button
    this.addZoomOrSelectButton(chart);


    // Add watermark
    chart.plotContainer.children.push(ChartHelper.getWaterMark(this.waterMark));

    // watermark.fontWeight = 'bold';


    // Scrollbar
    // chart.scrollbarX = new am4charts.XYChartScrollbar();

    // Add exporting options
    chart.exporting.menu = this.getExportingMenu();

    chart.exporting.extraSprites.push({
      'sprite': chart.legend.parent,
      'position': 'bottom',
      'marginTop': 20
    });

    // Add the anotation
    chart.plugins.push(new am4plugins_annotation.Annotation());

    // Disable the preloader
    chart.preloader.disabled = true;

    // Attach events
    chart.events.on('validated', (ev) => {
      this.logger.info('validated');
    });

    chart.events.on('globalscalechanged', (ev) => {
      this.logger.info('globalscalechanged');
    });

    chart.events.on('dataitemsvalidated', (ev) => {
      this.logger.info('dataitemsvalidated');
    });


    chart.events.on('datavalidated', (ev) => {
      this.logger.info('datavalidated');
    });

    chart.events.on('datarangechanged', (ev) => {
      this.logger.info('datarangechanged');
    });

    chart.events.on('ready', (ev) => {
      this.logger.info('ready');
    });


    chart.events.on('shown', (ev) => {
      this.logger.info('shown');
    });

    chart.events.on('transformed', (ev) => {
      this.logger.info('transformed');
    });

    chart.events.on('maxsizechanged', (ev) => {
      this.logger.info('maxsizechanged');
      ev.target.legend.svgContainer.htmlElement.style.height = this.chart.legend.contentHeight + 'px'; // @todo test
    });

    chart.events.on('visibilitychanged', (ev) => {
      this.logger.info('visibilitychanged');
    });

    chart.events.on('hidden', (ev) => {
      this.logger.info('hidden');
    });
    chart.events.on('shown', (ev) => {
      this.logger.info('shown');
    });

    chart.events.on('inited', (ev) => {
      this.logger.info('inited');
    });

    return chart;
  }

  private createOrUpdateChartSeries(activity: ActivityInterface, stream: StreamInterface): am4charts.XYSeries {
    // @todo try runoutisde angular
    let series = this.chart.series.values.find(seriesItem => seriesItem.id === this.getSeriesIDFromActivityAndStream(activity, stream));
    // If there is already a series with this id only data update should be done
    if (series) {
      series.data = this.convertStreamDataToSeriesData(activity, stream);
      return series
    }

    let yAxis: am4charts.ValueAxis | am4charts.DurationAxis;

    // Check if we have a series with the same name aka type
    const sameTypeSeries = this.chart.series.values.find((serie) => serie.name === this.getSeriesName(stream.type));
    if (!sameTypeSeries) {
      yAxis = this.chart.yAxes.push(this.getYAxisForSeries(stream.type));
    } else {
      // Share
      yAxis = <am4charts.ValueAxis | am4charts.DurationAxis>sameTypeSeries.yAxis;
    }


    if (stream.type === DataPower.type) {
      yAxis.extraMax = this.extraMaxForPower;
    }

    // yAxis.tooltip.disabled = true;
    // yAxis.interpolationDuration = 500;
    // yAxis.rangeChangeDuration = 500;
    yAxis.renderer.inside = false;
    yAxis.renderer.grid.template.disabled = !this.showGrid;
    yAxis.renderer.line.strokeOpacity = 1;

    if (this.stackYAxes) {

      // const categoryLabel = series.bullets.push(new am4charts.LabelBullet());
      // categoryLabel.label.text = '123';
      yAxis.align = 'right';
      yAxis.marginTop = 5;
    } else {
      yAxis.renderer.labels.template.marginLeft = 10;
      yAxis.paddingLeft = 5;
      yAxis.paddingRight = 0;
      yAxis.layout = 'absolute';
      yAxis.align = 'left';
      yAxis.renderer.line.align = 'right';
      yAxis.title.valign = 'middle';
      yAxis.title.align = 'left';


      // yAxis.layout = 'absolute';
      // yAxis.title.rotation = 0;
      // yAxis.title.align = 'center';
      // yAxis.title.valign = 'top';
      // yAxis.title.padding(10,10,10,10)
      // yAxis.title.dy = -40;
    }

    yAxis.renderer.minLabelPosition = 0.05;
    yAxis.renderer.maxLabelPosition = 0.95;
    yAxis.title.fontSize = '1.0em';
    yAxis.title.fontWeight = '600';

    yAxis.renderer.ticks.template.disabled = false;
    yAxis.renderer.ticks.template.strokeOpacity = 1;
    yAxis.renderer.ticks.template.strokeWidth = 1;
    yAxis.renderer.ticks.template.length = 5;
    yAxis.renderer.minGridDistance = 20;

    // Then create a series
    series = new am4charts.LineSeries();
    series.showOnInit = false;
    series = this.chart.series.push(series);
    series.id = this.getSeriesIDFromActivityAndStream(activity, stream);
    series.simplifiedProcessing = true;
    series.name = this.getSeriesName(stream.type);

    this.attachSeriesEventListeners(series);

    this.chart.series.sort((left, right) => {
      if (left.name < right.name) {
        return -1;
      }
      if (left.name > right.name) {
        return 1;
      }
      return 0;
    });

    // Set the axis
    series.yAxis = yAxis;


    // yAxis.title.text = `${series.name} ` + (DynamicDataLoader.getDataClassFromDataType(stream.type).unit ? ` (${DynamicDataLoader.getDataClassFromDataType(stream.type).unit})` : '');
    if (DynamicDataLoader.getUnitBasedDataTypesFromDataType(series.name, this.userUnitSettings).length > 1) {
      yAxis.title.text = `${series.name}`
    } else {
      yAxis.title.text = `${series.name} [font-size: 0.9em](${DynamicDataLoader.getDataClassFromDataType(stream.type).unit})[/]`
    }

    // Setup the series

    series.dummyData = {
      activity: activity,
      stream: stream,
    };

    // @todo use base type
    if ([DataPace.type, DataSwimPace.type, DataSwimPaceMaxMinutesPer100Yard.type, DataPaceMinutesPerMile.type].indexOf(stream.type) !== -1) {
      series.tooltipText = `${this.event.getActivities().length === 1 ? '' : activity.creator.name} ${DynamicDataLoader.getDataClassFromDataType(stream.type).type} {valueY.formatDuration()} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit}`;
    } else {
      series.tooltipText = `${this.event.getActivities().length === 1 ? '' : activity.creator.name} ${DynamicDataLoader.getDataClassFromDataType(stream.type).displayType || DynamicDataLoader.getDataClassFromDataType(stream.type).type} {valueY} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit}`;
    }

    series.legendSettings.labelText = `${DynamicDataLoader.getDataClassFromDataType(stream.type).displayType || DynamicDataLoader.getDataClassFromDataType(stream.type).type} ` + (DynamicDataLoader.getDataClassFromDataType(stream.type).unit ? ` (${DynamicDataLoader.getDataClassFromDataType(stream.type).unit})` : '') + ` [${am4core.color(this.eventColorService.getActivityColor(this.event.getActivities(), activity)).toString()}]${this.event.getActivities().length === 1 ? '' : activity.creator.name}[/]`;

    series.adapter.add('fill', (fill, target) => {
      return this.getSeriesColor(target);
    });
    series.adapter.add('stroke', (fill, target) => {
      return this.getSeriesColor(target);
    });

    series.strokeWidth = this.strokeWidth;
    series.strokeOpacity = this.strokeOpacity;
    series.fillOpacity = this.fillOpacity;
    // series.defaultState.transitionDuration = 0;

    series.dataFields.valueY = 'value';
    series.dataFields.dateX = 'time';
    series.dataFields.valueX = 'axisValue';
    // series.dataFields.categoryX = 'distance';

    series.interactionsEnabled = false;


    // If we have something in local storage
    if (this.hideAllSeriesOnInit) {
      series.hidden = true
    } else if (this.chartSettingsLocalStorageService.getSeriesIDsToShow(this.event).length) {
      if (this.chartSettingsLocalStorageService.getSeriesIDsToShow(this.event).indexOf(series.id) === -1) {
        series.hidden = true;
      }
    } else {
      // Else try to check what we should show by default
      if ([...UserService.getDefaultChartDataTypesToShowOnLoad(), ...ActivityTypesHelper.speedDerivedMetricsToUseForActivityType(activity.type)]
        .reduce((accu, dataType) => {
          return [...accu, ...DynamicDataLoader.getUnitBasedDataTypesFromDataType(dataType, this.userUnitSettings)]
        }, []).indexOf(stream.type) === -1) {
        series.hidden = true;
      }
    }

    // Attach events
    series.events.on('validated', (ev) => {
      // this.logger.info(`Series ${ev.target.id} validated`);
      ev.target.chart.legend.svgContainer.htmlElement.style.height = this.chart.legend.contentHeight + 'px';
      // this.loaded();
    });

    series.events.on('ready', (ev) => {
      this.logger.info('Series ready');
    });

    // Finally set the data and return
    this.zone.runOutsideAngular(() => {
      series.data = this.convertStreamDataToSeriesData(activity, stream);
    });
    return series;
  }

  private createRangeLabelsContainer(chart: am4charts.XYChart): am4core.Container {
    const rangeLabelsContainer = chart.plotContainer.createChild(am4core.Container);
    rangeLabelsContainer.id = 'rangeLabelsContainer';
    rangeLabelsContainer.width = am4core.percent(100);
    rangeLabelsContainer.height = am4core.percent(100);
    rangeLabelsContainer.x = 0;
    rangeLabelsContainer.y = am4core.percent(99);
    rangeLabelsContainer.layout = 'horizontal';
    // rangeLabelsContainer.align = 'center';
    // rangeLabelsContainer.verticalCenter = 'rop';
    rangeLabelsContainer.zIndex = 99;
    return rangeLabelsContainer

  }

  private createLabel(container: am4core.Container | am4charts.Chart, series: am4charts.Series, labelData: LabelData, hidden: boolean = false): am4core.Label {
    const labelContainer = container.createChild(am4core.Container);
    labelContainer.id = this.getSeriesRangeLabelContainerID(series);
    labelContainer.background.fillOpacity = 0.75;
    labelContainer.background.fill = am4core.color('#000');
    labelContainer.padding(15, 15, 15, 15);
    labelContainer.marginLeft = am4core.percent(0.5);
    labelContainer.horizontalCenter = 'middle';
    labelContainer.verticalCenter = 'bottom';
    labelContainer.background.stroke = am4core.color('#FFF');
    labelContainer.background.strokeOpacity = 0.6;
    labelContainer.background.strokeWidth = 0.65;

    // labelContainer.hidden = hidden;


    const label = labelContainer.createChild(am4core.Label);
    label.align = 'center';
    label.text = `
      [bold font-size: 1.2em ${series.stroke}]${labelData.name}[/]\n
      [bold font-size: 1.15em ${am4core.color(this.eventColorService.getActivityColor(this.event.getActivities(), series.dummyData.activity)).toString()}]${series.dummyData.activity.creator.name}[/]\n
      [bold font-size: 1.1em ${am4core.color('#FFFFFF')}]Avg:[/] [bold font-size: 1.2em ${am4core.color('#FFFFFF')}]${labelData.average.value}[/][${am4core.color('#FFFFFF')}]${labelData.average.unit}[/]\n
      [bold font-size: 1.1em ${am4core.color('#FFFFFF')}]Max:[/] [bold font-size: 1.2em ${am4core.color('#FFFFFF')}]${labelData.max.value}[/][${am4core.color('#FFFFFF')}]${labelData.max.unit}[/]\n
      [bold font-size: 1.1em ${am4core.color('#FFFFFF')}]Min:[/] [bold font-size: 1.2em ${am4core.color('#FFFFFF')}]${labelData.min.value}[/][${am4core.color('#FFFFFF')}]${labelData.min.unit}[/]\n
      [bold font-size: 1.1em ${am4core.color('#FFFFFF')}]Diff:[/] [bold font-size: 1.2em ${am4core.color('#FFFFFF')}]${labelData.minToMaxDiff === undefined ? '--' : labelData.minToMaxDiff.value}[/][${am4core.color('#FFFFFF')}]${labelData.minToMaxDiff === undefined ? '' : labelData.minToMaxDiff.unit}[/]\n
      [bold font-size: 1.1em ${am4core.color('#FFFFFF')}]Gain:[/] [bold font-size: 1.2em ${am4core.color('#FFFFFF')}]${labelData.gain === undefined ? '--' : labelData.gain.value}[/][${am4core.color('#FFFFFF')}]${labelData.gain === undefined ? '' : labelData.gain.unit}[/]\n
      [bold font-size: 1.1em ${am4core.color('#FFFFFF')}]Loss:[/] [bold font-size: 1.2em ${am4core.color('#FFFFFF')}]${labelData.loss === undefined ? '--' : labelData.loss.value}[/][${am4core.color('#FFFFFF')}]${labelData.loss === undefined ? '' : labelData.loss.unit}[/]\n
      [bold font-size: 1.1em ${am4core.color('#FFFFFF')}]Gradient:[/] [bold font-size: 1.2em ${am4core.color('#FFFFFF')}]${labelData.slopePercentage === undefined ? '--' : labelData.slopePercentage.value}[/][${am4core.color('#FFFFFF')}]${labelData.slopePercentage === undefined ? '' : '%'}[/]\n
      `;

    // Important! disable it after the creation of the child label
    labelContainer.disabled = hidden;
    return label;
  }

  private addZoomOrSelectButton(chart: am4charts.XYChart): am4core.Button {
    const button = chart.plotContainer.createChild(am4core.Button);
    button.id = 'zoomOrSelectButton';
    button.label.text = chart.cursor.behavior === 'selectX' ? 'Selecting' : 'Zooming';
    button.padding(10, 10, 10, 10);
    // button.width = 20;
    button.fontSize = '1.2em';
    button.align = 'left';
    button.marginLeft = 15;
    button.opacity = 0.8;

    button.zIndex = 20;
    button.events.on('hit', (ev) => {
      // debugger;
      chart.cursor.behavior = chart.cursor.behavior === ChartCursorBehaviours.SelectX ? ChartCursorBehaviours.ZoomX : ChartCursorBehaviours.SelectX;
      ev.target.label.text = chart.cursor.behavior === ChartCursorBehaviours.SelectX ? 'Selecting' : 'Zooming';
    });
    return button;
  }

  private addClearSelectionButton(chart: am4charts.XYChart): am4core.Button {
    const button = chart.plotContainer.createChild(am4core.Button);
    button.id = 'clearSelectionButton';
    button.label.text = 'Clear';
    button.padding(10, 10, 10, 10);
    // button.width = 20;
    button.y = 50;
    button.fontSize = '1.2em';
    button.align = 'left';
    button.marginLeft = 15;
    button.zIndex = 30;
    button.opacity = 0.8;
    button.events.on('hit', (ev) => {
      this.disposeRangeLabelsContainer(chart);
      this.disposeCursorSelection(chart);
      this.disposeClearSelectionButton(chart);
    });
    return button;
  }


  // @todo take a good look at getStreamDataTypesBasedOnDataType on utilities for an already existing implementation
  private convertStreamDataToSeriesData(activity: ActivityInterface, stream: StreamInterface): any {
    this.logger.info(`Stream data for ${stream.type} ${stream.data.length}`);
    let data = [];
    // this.logger.info(`Stream data for ${stream.type} length before sampling ${stream.data.length}`);
    if (this.xAxisType === XAxisTypes.Distance && this.distanceAxesForActivitiesMap.get(activity.getID())) {
      const distanceStream = this.distanceAxesForActivitiesMap.get(activity.getID());
      distanceStream.data.reduce((dataMap, distanceStreamDataItem, index) => { // Can use a data array but needs deduplex after
        if (stream.data[index] && isNumber(distanceStreamDataItem)) {
          // debugger;
          dataMap.set(distanceStreamDataItem, stream.data[index])
        }
        return dataMap;
      }, new Map<number, number>()).forEach((value, distance) => {
        if (value === null) {
          return;
        }
        data.push({
          axisValue: distance,
          value: value
        }) // @todo if needed sort here by distance
      });
    } else {
      data = this.xAxisType === XAxisTypes.Time ? stream.getStreamDataByTime(activity.startDate, true) : stream.getStreamDataByDuration((new Date(0)).getTimezoneOffset() * 60000, true); // Default unix timestamp is at 1 hours its kinda hacky but easy
    }

    // filter if needed (this operation costs)
    if (this.getStreamSamplingRateInSeconds(activity) !== 1) {
      data = data.filter((streamData, index) => (index % this.getStreamSamplingRateInSeconds(activity)) === 0);
    }
    this.logger.info(`Stream data for ${stream.type} after sampling and filtering ${data.length}`);
    return data;
  }

  private getStreamSamplingRateInSeconds(activity: ActivityInterface): number {
    if (this.downSamplingLevel === 1) {
      return 1;
    }
    // Rate is minimum 1
    const rate = this.downSamplingLevel || 1;
    // If we do not need to strengthen the downsampling based on the DOWNSAMPLE_AFTER_X_HOURS
    // then we just need to return the sampling rate the user has selected
    if (this.getActivityHours(activity) < DOWNSAMPLE_AFTER_X_HOURS) {
      return 1;
    }
    // return rate * (this.getActivityHours(activity) / DOWNSAMPLE_AFTER_X_HOURS);
    // If the activity needs a bump on downsampling > DOWNSAMPLE_AFTER_X_HOURS
    return rate * Math.ceil(Math.ceil(this.getActivityHours(activity) / DOWNSAMPLE_AFTER_X_HOURS) * DOWNSAMPLE_FACTOR_PER_HOUR);
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

  private getDataTypesToRequest(): string[] {
    if (this.getNonUnitBasedDataTypes().indexOf(DataSpeed.type) === -1) {
      return this.getNonUnitBasedDataTypes().concat([DataSpeed.type]);// Inject speed always for pace and swim pace till this is refactored
    }
    return this.getNonUnitBasedDataTypes();
  }

  /**
   * This get's the basic data types for the charts depending or not on the user datatype settings
   * There are no unit specific datatypes here so if the user has selected pace it implies metric
   */
  private getNonUnitBasedDataTypes(): string[] {
    // let dataTypes = DynamicDataLoader.basicDataTypes;
    // Set the datatypes to show if all is selected
    if (this.showAllData) {
      return DynamicDataLoader.allDataTypes;
    }
    if (!this.dataTypesToUse) {
      return DynamicDataLoader.basicDataTypes;
    }
    return this.dataTypesToUse;
  }

  protected disposeRangeLabelsContainer(chart: am4charts.XYChart) {
    const rangeLabelsContainer = chart.map.getKey('rangeLabelsContainer');
    if (rangeLabelsContainer) {
      rangeLabelsContainer.dispose();
    }
  }

  protected disposeClearSelectionButton(chart: am4charts.XYChart) {
    const clearSelectionButton = chart.map.getKey('clearSelectionButton');
    if (clearSelectionButton) {
      clearSelectionButton.dispose();
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

  protected clearChart() {
    if (this.chart) {
      this.chart.series.clear();
      this.chart.colors.reset();
      if (this.chart.yAxes.length) {
        this.chart.yAxes.clear();
      }
      this.disposeRangeLabelsContainer(this.chart);
      this.disposeCursorSelection(this.chart);
      this.disposeClearSelectionButton(this.chart);
      this.chart.xAxes.each(axis => axis.axisRanges.clear());
      // this.chart.xAxes.each(axis => axis.renderer.grid.template.disabled = true);
      // this.chart.yAxes.each(axis => axis.renderer.grid.template.disabled = true);
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
    return this.streamsSubscription ? [this.streamsSubscription] : [];
  }

  private getSeriesRangeLabelContainer(series): am4core.Container | null {
    return <am4core.Container>series.chart.map.getKey(this.getSeriesRangeLabelContainerID(series));
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
                const range = xAxis.axisRanges.create();
                if (xAxisType === XAxisTypes.Time) {
                  range.value = lap.endDate.getTime();
                } else if (xAxisType === XAxisTypes.Duration) {
                  range.value = (new Date(0).getTimezoneOffset() * 60000) + +lap.endDate - +activity.startDate;
                } else if (xAxisType === XAxisTypes.Distance && this.distanceAxesForActivitiesMap.get(activity.getID())) {
                  const data = this.distanceAxesForActivitiesMap
                    .get(activity.getID())
                    .getStreamDataByTime(activity.startDate, true)
                    .filter(streamData => streamData && (streamData.time >= lap.endDate.getTime()));
                  range.value = data[0].value
                }
                range.grid.stroke = am4core.color(this.eventColorService.getActivityColor(this.event.getActivities(), activity));
                range.grid.strokeWidth = 1;
                range.grid.strokeOpacity = 0.8;
                range.grid.strokeDasharray = '2,5';

                range.grid.above = true;
                range.grid.zIndex = 1;
                range.grid.tooltipText = `[${am4core.color(this.eventColorService.getActivityColor(this.event.getActivities(), activity)).toString()} bold font-size: 1.2em]${activity.creator.name}[/]\n[bold font-size: 1.0em]Lap #${lapIndex + 1}[/]\n[bold font-size: 1.0em]Type:[/] [font-size: 0.8em]${lapType}[/]`;
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
                // range.label.fill = range.grid.stroke;
                range.label.horizontalCenter = 'middle';
                range.label.valign = 'bottom';
                range.label.textAlign = 'middle';
                range.label.dy = 6;
                // range.grid.filters.push(ChartHelper.getShadowFilter())
              })
          });
      })
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
    // console.log(target.name)
    // console.log(this.getSameNameSeries(target).indexOf(target));
    if (this.getSameNameSeries(series).length < 2) {
      return AppDataColors[series.name] || this.getFillColor(series.chart, series.chart.series.indexOf(series));
    }

    return AppDataColors[`${series.name}_${this.getSameNameSeries(series).indexOf(series)}`] || this.getFillColor(series.chart, series.chart.series.indexOf(series));
  }


  protected attachSeriesEventListeners(series: am4charts.XYSeries) {
    // Shown
    // series.events.on('visibilitychanged', () => {
    //   console.log(`visibilitychanged ${series.id} ${series.visible} ${series.hidden}`)
    // });
    series.events.on('shown', () => {
      series.hidden = false;
      this.showSeriesYAxis(series);
      // console.log(series.name + ' shown stat: ' + series.hidden )
      if (this.getSeriesRangeLabelContainer(series)) {
        this.getSeriesRangeLabelContainer(series).disabled = false;
        this.getSeriesRangeLabelContainer(series).deepInvalidate();
      }

      // Snap to the shown series
      // if (this.xAxisType === XAxisTypes.Distance) {
      //   series.chart.cursor.snapToSeries = series;
      // }
      series.yAxis.height = am4core.percent(100);
      series.yAxis.invalidate();
      this.chartSettingsLocalStorageService.showSeriesID(this.event, series.id);
    });
    // Hidden
    series.events.on('hidden', () => {
      series.hidden = true;
      if (!this.getVisibleSeriesWithSameYAxis(series).length) {
        this.hideSeriesYAxis(series)
      }
      // console.log(series.name + ' hidden state: ' + series.visible)
      if (this.getSeriesRangeLabelContainer(series)) {
        this.getSeriesRangeLabelContainer(series).disabled = true;
      }
      // @todo should check for same visibel might need -1
      if (!this.getVisibleSeriesWithSameYAxis(series).length) {
        series.yAxis.height = 0;
      }
      // series.yAxis.disabled = true;
      series.yAxis.invalidate();
      this.chartSettingsLocalStorageService.hideSeriesID(this.event, series.id);
    });
  }

  protected getYAxisForSeries(streamType: string): am4charts.ValueAxis | am4charts.DurationAxis {
    let yAxis: am4charts.ValueAxis | am4charts.DurationAxis;
    if ([DataPace.type, DataPaceMinutesPerMile.type, DataSwimPace.type, DataSwimPaceMaxMinutesPer100Yard.type].indexOf(streamType) !== -1) {
      yAxis = new am4charts.DurationAxis()
    } else {
      yAxis = new am4charts.ValueAxis();
    }
    return yAxis;
  }

  protected hideSeriesYAxis(series: am4charts.XYSeries) {
    series.yAxis.disabled = true;
  }

  protected showSeriesYAxis(series: am4charts.XYSeries) {
    series.yAxis.disabled = false;
    // series.yAxis.renderer.grid.template.disabled = false;
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
    if ([
      DataSpeed.type,
      DataStrydSpeed.type,
      DataSpeedMetersPerMinute.type,
      DataSpeedFeetPerMinute.type,
      DataSpeedFeetPerSecond.type,
      DataSpeedMilesPerHour.type,
      DataSpeedKilometersPerHour.type
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


  protected unsubscribeAndClearChart() {
    this.unSubscribeFromAll();
    this.clearChart();
  }


  private unSubscribeFromAll() {
    this.getSubscriptions().forEach(subscription => subscription.unsubscribe());
    this.logger.info(`Unsubscribed from ${this.getSubscriptions().length} subscriptions`);
  }

  ngOnDestroy() {
    this.unSubscribeFromAll();
    super.ngOnDestroy();
  }

  private addXAxis(chart: am4charts.XYChart, xAxisType: XAxisTypes): am4charts.ValueAxis | am4charts.DateAxis {
    let xAxis;
    switch (xAxisType) {
      case XAxisTypes.Distance:
        xAxis = chart.xAxes.push(new am4charts.ValueAxis());
        // xAxis.extraMax = 0.01;
        xAxis.renderer.minGridDistance = 40;
        xAxis.strictMinMax = true;

        xAxis.numberFormatter = new am4core.NumberFormatter();
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
        xAxis = chart.xAxes.push(new am4charts.DateAxis());
        if (!this.disableGrouping) {
          const screenPixes = Math.max(...[this.windowService.windowRef.screen.width, this.windowService.windowRef.screen.height]) * this.windowService.windowRef.devicePixelRatio;
          this.logger.info(`Grouping data on ${screenPixes}`);
          xAxis.groupData = true;
          // xAxis.groupCount = 60 * 60 * GROUP_ON_X_HOURS;
          xAxis.groupCount = screenPixes
        }
        break;
      default:
        throw new Error(`Not implemented`)
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
    return xAxis;
  }

  private attachChartLegendToChart(chart) {
    return this.zone.runOutsideAngular(() => {
      // Create a Legend
      chart.legend = new am4charts.Legend();
      // legend.fontSize = '1em';

      chart.legend.parent = am4core.create(this.legendDiv.nativeElement, am4core.Container);
      this.logger.info(`Created legend with id ${chart.legend.parent.uid}`);
      chart.legend.parent.width = am4core.percent(100);
      chart.legend.parent.height = am4core.percent(100);

      chart.legend.useDefaultMarker = true;
      const marker = <am4core.RoundedRectangle>chart.legend.markers.template.children.getIndex(0);
      marker.cornerRadius(14, 14, 14, 14);
      marker.strokeWidth = 4;
      marker.strokeOpacity = 1;
      marker.stroke = am4core.color('#0a97ee');
    });
  }

  private destroyLegendParent() {
    return this.zone.runOutsideAngular(() => {
      if (this.chart && this.chart.legend && this.chart.legend.parent) {
        this.chart.legend.parent.dispose();
      }
    });
  }

  protected destroyChart() {
    this.destroyLegendParent();
    super.destroyChart();
  }

  getFillColor(chart: am4charts.XYChart | am4charts.PieChart, index: number) {
    return chart.colors.getIndex(index * 2);
  }
}
