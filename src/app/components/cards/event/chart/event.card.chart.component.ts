import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
} from '@angular/core';
import {Log} from 'ng2-logger/browser'
import {EventColorService} from '../../../../services/color/app.event.color.service';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {DataHeartRate} from 'quantified-self-lib/lib/data/data.heart-rate';
import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import {combineLatest, Subscription} from 'rxjs';
import {EventService} from '../../../../services/app.event.service';
import {DataAltitude} from 'quantified-self-lib/lib/data/data.altitude';
import {map, take} from 'rxjs/operators';
import {StreamInterface} from 'quantified-self-lib/lib/streams/stream.interface';
import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {DataPace, DataPaceMinutesPerMile} from 'quantified-self-lib/lib/data/data.pace';
import {ChartCursorBehaviours, XAxisTypes} from 'quantified-self-lib/lib/users/user.chart.settings.interface';
import {UserUnitSettingsInterface} from 'quantified-self-lib/lib/users/user.unit.settings.interface';
import {UserSettingsService} from '../../../../services/app.user.settings.service';
import {ThemeService} from '../../../../services/app.theme.service';
import {EventUtilities} from 'quantified-self-lib/lib/events/utilities/event.utilities';
import {ChartAbstract} from '../../../charts/chart.abstract';
import {DataDistance} from 'quantified-self-lib/lib/data/data.distance';
import {isNumber} from 'quantified-self-lib/lib/events/utilities/helpers';
import {ActivityTypes} from 'quantified-self-lib/lib/activities/activity.types';
import {DataSwimPace, DataSwimPaceMinutesPer100Yard} from 'quantified-self-lib/lib/data/data.swim-pace';
import {DataSwimPaceMaxMinutesPer100Yard} from 'quantified-self-lib/lib/data/data.swim-pace-max';
import {DataGPSAltitude} from 'quantified-self-lib/lib/data/data.altitude-gps';
import {DataAccumulatedPower} from 'quantified-self-lib/lib/data/data.accumulated-power';
import {DataTemperature} from 'quantified-self-lib/lib/data/data.temperature';
import {DataSpeed} from 'quantified-self-lib/lib/data/data.speed';
import {UserService} from '../../../../services/app.user.service';
import {LapTypes} from 'quantified-self-lib/lib/laps/lap.types';

@Component({
  selector: 'app-event-card-chart',
  templateUrl: './event.card.chart.component.html',
  styleUrls: ['./event.card.chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventCardChartComponent extends ChartAbstract implements OnChanges, OnInit, OnDestroy, AfterViewInit {

  @Input() event: EventInterface;
  @Input() targetUserID: string;
  @Input() userUnitSettings: UserUnitSettingsInterface;
  @Input() selectedActivities: ActivityInterface[] = [];
  @Input() isVisible: boolean;
  @Input() showAllData: boolean;
  @Input() showLaps: boolean;
  @Input() lapTypes: LapTypes[];
  @Input() xAxisType: XAxisTypes;
  @Input() dataSmoothingLevel: number;
  @Input() waterMark: string;
  @Input() chartCursorBehaviour: ChartCursorBehaviours;


  public distanceAxesForActivitiesMap = new Map<string, StreamInterface>();
  public isLoading: boolean;

  private streamsSubscription: Subscription;
  protected chart: am4charts.XYChart;
  protected logger = Log.create('EventCardChartComponent');


  constructor(changeDetector: ChangeDetectorRef,
              protected zone: NgZone,
              private eventService: EventService,
              private userSettingsService: UserSettingsService,
              private themeService: ThemeService,
              private eventColorService: EventColorService) {
    super(zone, changeDetector);
  }

  async ngAfterViewInit() {
  }

  async ngOnInit() {
    if (!this.targetUserID || !this.event) {
      throw new Error('Component needs events and users');
    }
  }

  async ngOnChanges(simpleChanges) {
    // WARNING DO NOT ALLOW READS IF NOT VISIBLE! //

    // If not visible and no data is bound do nothing
    if (!this.isVisible && (!this.streamsSubscription || this.streamsSubscription.closed)) {
      return;
    }

    if (simpleChanges.chartTheme || simpleChanges.xAxisType || simpleChanges.chartCursorBehaviour) {
      this.destroyChart();
    }

    // 1. If there is no chart create
    if (!this.chart) {
      this.chart = this.createChart();
    }

    // Beyond here component is visible and data is not bound //

    // 3. If something changed then do the needed
    if (simpleChanges.event
      || simpleChanges.selectedActivities
      || simpleChanges.showAllData
      || simpleChanges.showLaps
      || simpleChanges.lapTypes
      || simpleChanges.userChartSettings
      || simpleChanges.dataSmoothingLevel
      || simpleChanges.xAxisType
      || simpleChanges.chartTheme) {
      if (!this.event || !this.selectedActivities.length) {
        this.unsubscribeAndClearChart();
        return;
      }
      this.unsubscribeAndClearChart();
      await this.processChanges(await this.userSettingsService.selectedDataTypes(this.event));
      return;
    }

    // 4. If nothing has changed but we do not have data binding then bind
    if (!this.streamsSubscription || this.streamsSubscription.closed) {
      await this.processChanges(await this.userSettingsService.selectedDataTypes(this.event));
    }
  }

  private async processChanges(selectedDataTypes: string[] | null) {
    this.loading();
    am4core.options.minPolylineStep = this.dataSmoothingLevel;
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
          // If its a swimming activity it will detect the corresponding metrics
          return this.getUnitBasedDataTypesFromDataTypes(streams.map(st => st.type), this.userUnitSettings).indexOf(stream.type) !== -1;
        });
        return unitStreams.concat(streams).filter((stream) => {
          // Filter out pace if swimming
          if ([ActivityTypes.Swimming, ActivityTypes['Open water swimming']].indexOf(activity.type) !== -1) {
            return [DataPace.type, DataPaceMinutesPerMile.type].indexOf(stream.type) === -1;
          }
          return [DataSwimPace.type, DataSwimPaceMinutesPer100Yard.type].indexOf(stream.type) === -1;
        }).map((stream) => {
          return this.createOrUpdateChartSeries(activity, stream, selectedDataTypes);
        });
      }))
    })).pipe(map((seriesArrayOfArrays) => {
      // Format flatten the arrays as they come in [[], []]
      return seriesArrayOfArrays.reduce((accu: [], item: []): am4charts.XYSeries[] => accu.concat(item), [])
    })).subscribe((series: am4charts.LineSeries[]) => {

      if (this.showLaps) {
        this.addLapGuides(this.chart, this.selectedActivities, this.xAxisType, this.lapTypes);
      }

      // this.chart.xAxes.getIndex(0).title.text = this.xAxisType;
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

  protected createChart(): am4charts.XYChart {
    const chart = <am4charts.XYChart>super.createChart(am4charts.XYChart);

    chart.fontSize = '0.75em';
    // chart.padding(0, 10, 0, 0);
    // chart.resizable = false;

    // Add scrollbar
    chart.scrollbarX = new am4core.Scrollbar();

    let xAxis;
    if (this.xAxisType === XAxisTypes.Distance) {
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
    } else {
      // Create a date axis
      xAxis = chart.xAxes.push(new am4charts.DateAxis());
    }
    xAxis.title.text = this.xAxisType;
    xAxis.renderer.grid.template.disabled = true;

    xAxis.renderer.ticks.template.disabled = false;
    xAxis.renderer.ticks.template.strokeOpacity = 1;
    xAxis.renderer.ticks.template.strokeWidth = 1;
    xAxis.renderer.ticks.template.length = 10;

    xAxis.padding = 0;


    // Create a Legend
    chart.legend = new am4charts.Legend();
    chart.legend.fontSize = '0.9em';
    chart.legend.parent = am4core.create(this.legendDiv.nativeElement, am4core.Container);
    chart.legend.parent.width = am4core.percent(100);
    chart.legend.parent.height = am4core.percent(100);

    chart.legend.useDefaultMarker = true;
    const marker = <am4core.RoundedRectangle>chart.legend.markers.template.children.getIndex(0);
    marker.cornerRadius(14, 14, 14, 14);
    marker.strokeWidth = 2;
    marker.strokeOpacity = 1;
    marker.stroke = am4core.color('#0a97ee');

    chart.legend.itemContainers.template.events.on('toggled', (ev) => {
      const series = <am4charts.LineSeries>ev.target.dataItem.dataContext;
      // Getting visible...
      if (!ev.target.readerChecked === true) {
        this.showSeries(series, true)
      } else {
        this.hideSeries(series, true)
      }
    });

    // Create a cursor
    chart.cursor = new am4charts.XYCursor();

    chart.cursor.interactions.hitOptions.hitTolerance = 1;

    chart.cursor.behavior = this.chartCursorBehaviour;
    chart.cursor.zIndex = 10;
    chart.cursor.hideSeriesTooltipsOnSelection = true;
    // Sticky
    // chart.cursor.events.on('cursorpositionchanged', (event) => {
    //   chart.cursor.triggerMove(event.target.point, 'soft');
    // });
    // On select
    chart.cursor.events.on('selectended', (ev) => {
      this.disposeRangeLabelsContainer(ev.target.chart);
      this.disposeClearSelectionButton(ev.target.chart);
      this.addClearSelectionButton(ev.target.chart);
      const range = ev.target.xRange;
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
            value: data.length ? `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getGainOrLoss(data, true, 1)).getDisplayValue()}` : '--',
            unit: `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getGainOrLoss(data, true, 1)).getDisplayUnit()}`
          };
          labelData.loss = {
            value: data.length ? `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getGainOrLoss(data, false, 1)).getDisplayValue()}` : '--',
            unit: `${DynamicDataLoader.getDataInstanceFromDataType(series.dummyData.stream.type, EventUtilities.getGainOrLoss(data, false, 1)).getDisplayUnit()}`
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
    const watermark = new am4core.Label();
    watermark.text = this.waterMark || 'Quantified-Self.io';
    chart.plotContainer.children.push(watermark);
    watermark.align = 'right';
    watermark.valign = 'bottom';
    watermark.fontSize = '2.1em';
    watermark.opacity = 0.8;
    watermark.marginRight = 25;
    watermark.marginBottom = 10;
    watermark.zIndex = 100;
    watermark.filters.push(this.getShadowFilter());

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
      // ev.target.legend.svgContainer.htmlElement.style.height = this.chart.legend.contentHeight + 'px'; // @todo test
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

  private createOrUpdateChartSeries(activity: ActivityInterface, stream: StreamInterface, selectedDataTypes?: string[] | null): am4charts.XYSeries {
    let series = this.chart.series.values.find(seriesItem => seriesItem.id === this.getSeriesIDFromActivityAndStream(activity, stream));
    // If there is already a series with this id only data update should be done
    if (series) {
      series.data = this.convertStreamDataToSeriesData(activity, stream);
      return series
    }

    let yAxis: am4charts.Axis;

    // Check if we have a series with the same name aka type
    const sameTypeSeries = this.chart.series.values.find((serie) => serie.name === this.getSeriesName(stream.type));
    if (!sameTypeSeries) {
      yAxis = this.chart.yAxes.push(this.getYAxisForSeries(stream.type));
    } else {
      // Share
      yAxis = sameTypeSeries.yAxis;
    }

    // yAxis.tooltip.disabled = true;
    // yAxis.interpolationDuration = 500;
    // yAxis.rangeChangeDuration = 500;
    yAxis.renderer.inside = false;
    // yAxis.renderer.minLabelPosition = -1;
    // yAxis.renderer.maxLabelPosition = -1;
    // yAxis.renderer.axisFills.template.disabled = true;
    yAxis.renderer.grid.template.disabled = true;

    // yAxis.renderer.ticks.template.disabled = false;
    // yAxis.renderer.ticks.template.strokeOpacity = 1;
    // yAxis.renderer.ticks.template.strokeWidth = 1;
    // yAxis.renderer.ticks.template.length = 2;

    // yAxis.adapter.add('getTooltipText', (text, target) => {
    //   return text;
    // });


    // Then create a series
    series = this.chart.series.push(new am4charts.LineSeries());
    series.id = this.getSeriesIDFromActivityAndStream(activity, stream);
    series.simplifiedProcessing = true;

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

    // Setup the series

    // Name is acting like a type so get them grouped
    series.name = this.getSeriesName(stream.type);
    series.dummyData = {
      activity: activity,
      stream: stream,
    };

    // @todo use base type
    if ([DataPace.type, DataSwimPace.type, DataSwimPaceMaxMinutesPer100Yard.type, DataPaceMinutesPerMile.type].indexOf(stream.type) !== -1) {
      series.tooltipText = `${activity.creator.name} ${DynamicDataLoader.getDataClassFromDataType(stream.type).type} {valueY.formatDuration()} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit}`;
    } else {
      series.tooltipText = `${activity.creator.name} ${DynamicDataLoader.getDataClassFromDataType(stream.type).displayType || DynamicDataLoader.getDataClassFromDataType(stream.type).type} {valueY} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit}`;
    }

    series.legendSettings.labelText = `${DynamicDataLoader.getDataClassFromDataType(stream.type).displayType || DynamicDataLoader.getDataClassFromDataType(stream.type).type} ` + (DynamicDataLoader.getDataClassFromDataType(stream.type).unit ? ` (${DynamicDataLoader.getDataClassFromDataType(stream.type).unit})` : '') + ` [${am4core.color(this.eventColorService.getActivityColor(this.event, activity)).toString()}]${activity.creator.name}[/]`;
    // series.legendSettings.itemValueText = `{valueY} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit}`;

    // // Search if there is any other series with the same color we would like to have
    // const found = this.chart.series.values.find((seriesItem) => {
    //   return seriesItem.stroke.toString() === am4core.color(this.eventColorService.getActivityColor(this.event, activity)).toString();
    // });
    // // IF there is no other series with the same color then add the activity color
    // // if (!found) {
    // //   // series.stroke = am4core.color(this.eventColorService.getActivityColor(this.event, activity));
    // //   // series.fill = am4core.color(this.eventColorService.getActivityColor(this.event, activity));
    // //   series.adapter.add('fill', (fill, target) => {
    // //     return series.chart.colors.getIndex(series.chart.series.indexOf(target));
    // //   });
    // //   series.adapter.add('stroke', (fill, target) => {
    // //     return series.chart.colors.getIndex(series.chart.series.indexOf(target));
    // //   });
    // // }
    // series.adapter.add('fill', (fill, target) => {
    //   return series.chart.colors.getIndex(series.chart.series.indexOf(target));
    // });
    // series.adapter.add('stroke', (fill, target) => {
    //   return series.chart.colors.getIndex(series.chart.series.indexOf(target));
    // });
    series.adapter.add('fill', (fill, target) => {
      return this.getFillColor(target.chart, target.chart.series.indexOf(target));
    });
    series.adapter.add('stroke', (fill, target) => {
      return this.getFillColor(target.chart, target.chart.series.indexOf(target));
    });
    if (this.userChartSettings) {
      series.strokeWidth = this.userChartSettings.strokeWidth;
      series.strokeOpacity = this.userChartSettings.strokeOpacity;
      series.fillOpacity = this.userChartSettings.fillOpacity;
    } else {
      series.strokeWidth = UserService.getDefaultChartStrokeWidth();
      series.strokeOpacity = UserService.getDefaultChartStrokeOpacity();
      series.fillOpacity = UserService.getDefaultChartFillOpacity();
    }
    // series.defaultState.transitionDuration = 0;

    series.dataFields.valueY = 'value';
    series.dataFields.dateX = 'time';
    series.dataFields.valueX = 'axisValue';
    // series.dataFields.categoryX = 'distance';

    series.interactionsEnabled = false;

    // Show an hide on condition
    if (selectedDataTypes && selectedDataTypes.length) {
      if (selectedDataTypes.indexOf(series.id) === -1) {
        this.hideSeries(series);
      } else {
        this.showSeries(series);
      }
    } else if (([DataHeartRate.type, DataAltitude.type].indexOf(stream.type) === -1) || this.getVisibleSeries(this.chart).length > (this.selectedActivities.length * 2)) {
      this.hideSeries(series);
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

    // this.chart.invalidateData(); // @todo Perhaps this can go away.
    // Finally set the data and return
    series.data = this.convertStreamDataToSeriesData(activity, stream);
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
      [bold font-size: 1.4em ${series.stroke}]${labelData.name}[/]\n
      [bold font-size: 1.25em ${am4core.color(this.eventColorService.getActivityColor(this.event, series.dummyData.activity)).toString()}]${series.dummyData.activity.creator.name}[/]\n
      [bold font-size: 1.2em ${am4core.color('#FFFFFF')}]Avg:[/] [bold font-size: 1.4em ${am4core.color('#FFFFFF')}]${labelData.average.value}[/][${am4core.color('#FFFFFF')}]${labelData.average.unit}[/]\n
      [bold font-size: 1.2em ${am4core.color('#FFFFFF')}]Max:[/] [bold font-size: 1.4em ${am4core.color('#FFFFFF')}]${labelData.max.value}[/][${am4core.color('#FFFFFF')}]${labelData.max.unit}[/]\n
      [bold font-size: 1.2em ${am4core.color('#FFFFFF')}]Min:[/] [bold font-size: 1.4em ${am4core.color('#FFFFFF')}]${labelData.min.value}[/][${am4core.color('#FFFFFF')}]${labelData.min.unit}[/]\n
      [bold font-size: 1.2em ${am4core.color('#FFFFFF')}]Diff:[/] [bold font-size: 1.4em ${am4core.color('#FFFFFF')}]${labelData.minToMaxDiff === undefined ? '--' : labelData.minToMaxDiff.value}[/][${am4core.color('#FFFFFF')}]${labelData.minToMaxDiff === undefined ? '' : labelData.minToMaxDiff.unit}[/]\n
      [bold font-size: 1.2em ${am4core.color('#FFFFFF')}]Gain:[/] [bold font-size: 1.4em ${am4core.color('#FFFFFF')}]${labelData.gain === undefined ? '--' : labelData.gain.value}[/][${am4core.color('#FFFFFF')}]${labelData.gain === undefined ? '' : labelData.gain.unit}[/]\n
      [bold font-size: 1.2em ${am4core.color('#FFFFFF')}]Loss:[/] [bold font-size: 1.4em ${am4core.color('#FFFFFF')}]${labelData.loss === undefined ? '--' : labelData.loss.value}[/][${am4core.color('#FFFFFF')}]${labelData.loss === undefined ? '' : labelData.loss.unit}[/]\n
      [bold font-size: 1.2em ${am4core.color('#FFFFFF')}]Gradient:[/] [bold font-size: 1.4em ${am4core.color('#FFFFFF')}]${labelData.slopePercentage === undefined ? '--' : labelData.slopePercentage.value}[/][${am4core.color('#FFFFFF')}]${labelData.slopePercentage === undefined ? '' : '%'}[/]\n
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
    button.fontSize = '1.4em';
    button.align = 'left';
    button.marginLeft = 15;
    button.opacity = 0.5;

    button.zIndex = 100;
    button.events.on('hit', (ev) => {
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
    button.fontSize = '1.4em';
    button.align = 'left';
    button.marginLeft = 15;
    button.zIndex = 100;
    button.opacity = 0.5;
    button.events.on('hit', (ev) => {
      this.disposeRangeLabelsContainer(chart);
      this.disposeCursorSelection(chart);
      this.disposeClearSelectionButton(chart);
    });
    return button;
  }


  // @todo take a good look at getStreamDataTypesBasedOnDataType on utilities for an already existing implementation
  private convertStreamDataToSeriesData(activity: ActivityInterface, stream: StreamInterface): any {
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
        data.push({
          axisValue: distance,
          value: value
        }) // @todo if needed sort here by distance
      });
    } else {
      data = this.xAxisType === XAxisTypes.Time ? stream.getStreamDataByTime(activity.startDate) : stream.getStreamDataByDuration((new Date(0)).getTimezoneOffset() * 60000); // Default unix timestamp is at 1 hours its kinda hacky but easy
    }
    data = data
      .filter((streamData) => streamData.value !== null)
      .filter((streamData, index) => (index % this.getStreamSamplingRate(activity)) === 0);
    // this.logger.info(`Stream data for ${stream.type} after sampling and filtering ${data.length}`);
    return data;
  }

  private getStreamSamplingRateInSeconds(stream: StreamInterface): number {
    if (this.dataSmoothingLevel === 1) {
      return 1;
    }
    const numberOfSamples = stream.getNumericData().length;
    let samplingRate;
    const hoursToKeep1sSamplingRateForAllActivities = 2; // 2 hours
    const numberOfSamplesToHours = numberOfSamples / 3600;
    samplingRate = Math.ceil((numberOfSamplesToHours * this.dataSmoothingLevel * this.selectedActivities.length) / hoursToKeep1sSamplingRateForAllActivities);
    // this.logger.info(`${numberOfSamples} for ${stream.type} are about ${numberOfSamplesToHours} hours. Sampling rate is ${samplingRate}`);
    return samplingRate;
  }

  private getStreamSamplingRate(activity: ActivityInterface): number {
    const hours = Math.ceil((activity.getDuration().getValue() / (60 * 60)));
    return Math.ceil(hours / 2);
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
    return this.getNonUnitBasedDataTypes().concat([DataSpeed.type]); // Inject speed always for pace and swim pace till this is refactored
  }

  /**
   * This get's the basic data types for the charts depending or not on the user datatype settings
   * There are no unit specific datatypes here so if the user has selected pace it implies metric
   */
  private getNonUnitBasedDataTypes(): string[] {
    let dataTypes = DynamicDataLoader.basicDataTypes;
    // Set the datatypes to show if all is selected
    if (this.showAllData) {
      dataTypes = DynamicDataLoader.allDataTypes;
    }
    // If there is a change in the user chart settings and its valid update settings
    if (this.userChartSettings && !this.showAllData) {
      // Set the datatypes to use
      dataTypes = Object.keys(this.userChartSettings.dataTypeSettings).reduce((dataTypesToUse, dataTypeSettingsKey) => {
        if (this.userChartSettings.dataTypeSettings[dataTypeSettingsKey].enabled === true) {
          dataTypesToUse.push(dataTypeSettingsKey);
        }
        return dataTypesToUse;
      }, []);
    }
    return dataTypes;
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
      cursor.selection.hide();
    }
  }

  protected clearChart() {
    super.clearChart();
    if (this.chart) {
      this.chart.yAxes.clear();
      this.disposeRangeLabelsContainer(this.chart);
      this.disposeCursorSelection(this.chart);
      this.disposeClearSelectionButton(this.chart);
    }
  }

  protected hideSeries(series: am4charts.XYSeries, save?: boolean) {
    super.hideSeries(series);
    if (this.getSeriesRangeLabelContainer(series)) {
      this.getSeriesRangeLabelContainer(series).disabled = true;
    }
    if (save) {
      this.userSettingsService.setSelectedDataTypes(this.event, this.getVisibleSeries(series.chart).map(series => series.id));
    }
  }

  protected showSeries(series: am4charts.XYSeries, save?: boolean) {
    super.showSeries(series);
    if (this.getSeriesRangeLabelContainer(series)) {
      this.getSeriesRangeLabelContainer(series).disabled = false;
      this.getSeriesRangeLabelContainer(series).deepInvalidate();
    }
    if (save) {
      this.userSettingsService.setSelectedDataTypes(this.event, this.getVisibleSeries(series.chart).map(series => series.id));
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
                const xAxis = <am4charts.ValueAxis | am4charts.DateAxis>chart.xAxes.getIndex(0);
                const range = xAxis.axisRanges.create();
                if (xAxisType === XAxisTypes.Time) {
                  range.value = lap.endDate.getTime();
                } else if (xAxisType === XAxisTypes.Duration) {
                  range.value = (new Date(0).getTimezoneOffset() * 60000) + +lap.endDate - +activity.startDate;
                } else {
                  const data = this.distanceAxesForActivitiesMap
                    .get(activity.getID())
                    .getStreamDataByTime(activity.startDate)
                    .filter(streamData => streamData && (streamData.time >= lap.endDate.getTime()));
                  range.value = data[0].value
                }
                range.grid.stroke = am4core.color('#396478');
                range.grid.strokeWidth = 1;
                range.grid.strokeOpacity = 0.5;

                range.grid.above = true;
                range.grid.zIndex = 1;
                range.grid.tooltipText = `[bold font-size: 1em]Lap #${lapIndex + 1}[/]\n[bold font-size: 1.0em]${activity.creator.name}[/]\n[bold font-size: 1.0em]Type:[/] [font-size: 0.8em]${lapType}[/]`;
                range.grid.tooltipPosition = 'pointer';
                range.label.inside = true;
                range.label.adapter.add('text', () => {
                  return `${lapIndex + 1}`;
                });
                range.label.zIndex = 2;
                range.label.paddingTop = 2;
                range.label.paddingBottom = 2;
                // range.label.margin(2,12,12,2)
                // range.label.margin(0,0,0,0)
                range.label.fontSize = '1em';
                // range.label.background.fill =  am4core.color('#d9d9d9');
                range.label.background.fillOpacity = 0.9;
                range.label.background.stroke = am4core.color('#396478'); // @todo group colors
                range.label.background.strokeWidth = 1;
                // range.label.tooltipText = range.grid.tooltipText;
                // range.label.interactionsEnabled = true;

                range.label.background.width = 1;
                // range.label.fill = range.grid.stroke;
                range.label.horizontalCenter = 'middle';
                range.label.valign = 'bottom';
                range.label.textAlign = 'middle';
                range.label.dy = 6;

                // range.grid.filters.push(this.getShadowFilter())
              })
          });
      })
  }

  private removeLapGuides(chart: am4charts.XYChart) {
    chart.xAxes.getIndex(0).axisRanges.clear();
  }
}

export interface LabelData {
  name: string,
  average: { value: string, unit: string },
  min: { value: string, unit: string },
  max: { value: string, unit: string },
  gain?: { value: string, unit: string },
  loss?: { value: string, unit: string },
  minToMaxDiff?: { value: string, unit: string },
  slopePercentage?: { value: string, unit: string },
}
