import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import { AppEventService } from '../../services/app.event.service';
import { Subscription } from 'rxjs';
import { EventInterface } from '@sports-alliance/sports-lib';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAuthService } from '../../authentication/app.auth.service';
import { User } from '@sports-alliance/sports-lib';
import { ChartThemes } from '@sports-alliance/sports-lib';
import { AppThemeService } from '../../services/app.theme.service';
import { DataActivityTypes } from '@sports-alliance/sports-lib';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import * as Sentry from '@sentry/browser';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TileChartSettingsInterface,
  TileMapSettingsInterface,
  TileSettingsInterface,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { isNumber } from '@sports-alliance/sports-lib';
import { MatDialog } from '@angular/material/dialog';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';
import equal from 'fast-deep-equal';
import { DataAscent } from '@sports-alliance/sports-lib';
import * as weeknumber from 'weeknumber'
import { convertIntensityZonesStatsToChartData } from '../../helpers/intensity-zones-chart-data-helper';

@Component({
  selector: 'app-summaries',
  templateUrl: './summaries.component.html',
  styleUrls: ['./summaries.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class SummariesComponent extends LoadingAbstractDirective implements OnInit, OnDestroy, OnChanges {
  @Input() events: EventInterface[];
  @Input() user: User;
  @Input() showActions: boolean;

  public rowHeight;
  public numberOfCols: number;


  public tiles: (SummariesChartTileInterface | SummariesMapTileInterface | TileSettingsInterface)[] = [];

  public tileTypes = TileTypes;


  private chartThemeSubscription: Subscription;
  private chartTheme: ChartThemes;

  private getChartDataCache: { string: SummariesChartDataInterface[] }[] = []

  constructor(private router: Router,
    private authService: AppAuthService,
    private eventService: AppEventService,
    private themeService: AppThemeService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    changeDetector: ChangeDetectorRef,
  ) {
    super(changeDetector);
    this.rowHeight = this.getRowHeight();
    this.numberOfCols = this.getNumberOfColumns();
  }

  @HostListener('window:resize', ['$event'])
  @HostListener('window:orientationchange', ['$event'])
  resizeOROrientationChange(event?) {
    this.numberOfCols = this.getNumberOfColumns();
    this.rowHeight = this.getRowHeight();
  }

  ngOnInit() {
  }

  async ngOnChanges(simpleChanges: SimpleChanges) {
    if (simpleChanges.events || simpleChanges.user) {
      this.getChartDataCache = [];
      return this.unsubscribeAndCreateCharts();
    }
  }

  ngOnDestroy(): void {
    this.unsubscribeFromAll();
  }

  getEventCategoryKey(event: EventInterface, events: EventInterface[], categoryType: ChartDataCategoryTypes, timeInterval: TimeIntervals): string | number {
    switch (categoryType) {
      case ChartDataCategoryTypes.ActivityType:
        const eventTypeDisplayStat = <DataActivityTypes>event.getStat(DataActivityTypes.type);
        // this should not happen :-)
        if (!eventTypeDisplayStat) {
          Sentry.captureException(new Error(`No eventTypeDisplayStat found for event with id ${event.getID()} and user ${this.user.uid}`));
          return '??'
        }
        // Log an error to notify us what is missing
        if (eventTypeDisplayStat.getValue().length === 1 && !ActivityTypes[eventTypeDisplayStat.getDisplayValue()]) {
          Sentry.captureException(new Error(`Activity type with ${eventTypeDisplayStat.getDisplayValue()} is not known`));
          return '??';
        }
        return eventTypeDisplayStat.getValue().length > 1 ? ActivityTypes.Multisport : ActivityTypes[eventTypeDisplayStat.getDisplayValue()];
      case ChartDataCategoryTypes.DateType:
        switch (timeInterval !== TimeIntervals.Auto ? timeInterval : this.getEventsTimeInterval(events)) {
          case TimeIntervals.Yearly:
            return new Date(event.startDate.getFullYear(), 0).getTime();
          case TimeIntervals.Monthly:
            return new Date(event.startDate.getFullYear(), event.startDate.getMonth()).getTime();
          case TimeIntervals.Weekly:
            // See https://stackoverflow.com/questions/16590500/javascript-calculate-date-from-week-number
            const date = new Date(event.startDate.getFullYear(), 0, (1 + (weeknumber.weekNumber(event.startDate) - 1) * 7));
            date.setDate(date.getDate() + (1 - date.getDay()));
            return date.getTime();
          case TimeIntervals.Daily:
            return new Date(event.startDate.getFullYear(), event.startDate.getMonth(), event.startDate.getDate()).getTime();
          case TimeIntervals.Hourly:
            return new Date(event.startDate.getFullYear(), event.startDate.getMonth(), event.startDate.getDate(), event.startDate.getHours(), event.startDate.getMinutes()).getTime();
          default:
            return event.startDate.getTime()
        }
    }
  }

  public trackByTile(index: number, item: (SummariesChartTileInterface | SummariesMapTileInterface)) {
    if (!item) {
      return null;
    }
    return isSummariesChartTile(item) ?
      `${item.chartType}${item.dataCategoryType}${item.dataValueType}${item.name}${item.order}${item.timeInterval}`
      : `${item.clusterMarkers}${item.mapTheme}${item.mapType}${item.name}${item.order}${item.showHeatMap}`
  }

  private async unsubscribeAndCreateCharts() {
    this.unsubscribeFromAll();
    // Subscribe to the chartTheme changes
    this.chartThemeSubscription = this.themeService.getChartTheme().subscribe((chartTheme) => {
      this.chartTheme = chartTheme;
    });
    if (this.events) {
      this.events = this.events.filter(event => !event.isMerge).sort((eventA: EventInterface, eventB: EventInterface) => +eventA.startDate - +eventB.startDate)
    }

    const newTiles = this.getChartsAndData(this.user.settings.dashboardSettings.tiles, this.events);
    // if there are no current charts get and assign and get done
    if (!this.tiles.length && newTiles.length) {
      this.tiles = newTiles;
      this.loaded();
      return;
    }

    // Here we need to update:
    // 1. Go over the new ones
    // 2. If there is a current one and differs update it
    // 3. If not leave it alone so no change detection is triggered to the children
    newTiles.forEach(newChart => {
      // Find one with the same order
      const sameOrderChart = this.tiles.find(chart => chart.order === newChart.order);
      // If none of the same order then its new so only push
      if (!sameOrderChart) {
        this.tiles.push(newChart);
        return;
      }
      // If we found one with the same order then compare for changes
      // if its equal then noop / no equal replace the current index
      if (!equal(sameOrderChart, newChart)) {
        this.tiles[this.tiles.findIndex(chart => chart === sameOrderChart)] = newChart;
      }
    });
    // Here we need to remove non existing ones
    this.tiles = this.tiles.filter(chart => newTiles.find(newChart => newChart.order === chart.order));
    this.loaded();
  }

  /**
   * Contrustucts an object to the view template `TileSettingsInterface`
   * @param tiles
   * @param events
   * @private
   */
  private getChartsAndData(tiles: TileSettingsInterface[], events?: EventInterface[]): (SummariesChartTileInterface | SummariesMapTileInterface | TileSettingsInterface)[] {
    return tiles.reduce((chartsAndData: (SummariesChartTileInterface | SummariesMapTileInterface | TileSettingsInterface)[], tile) => {
      switch (tile.type) {
        // Chart
        case TileTypes.Chart:
          const chartTile = <TileChartSettingsInterface>tile;
          chartTile.dataTimeInterval = chartTile.dataTimeInterval || TimeIntervals.Auto
          // 2 Different processing here, one generic and one for Brian Devine
          switch (chartTile.chartType) {
            case ChartTypes.BrianDevine:
              const data = {
                daily: this.getChartData(events, chartTile.dataType, chartTile.dataValueType, ChartDataCategoryTypes.DateType, TimeIntervals.Daily),
                weekly: this.getChartData(events, chartTile.dataType, chartTile.dataValueType, ChartDataCategoryTypes.DateType, TimeIntervals.Weekly),
                activityTypes: [...new Set(events.map((event) => this.getEventCategoryKey(event, events, ChartDataCategoryTypes.ActivityType, chartTile.dataTimeInterval)))]
              };
              chartsAndData.push({
                ...chartTile, ...{
                  timeInterval: chartTile.dataTimeInterval === TimeIntervals.Auto ? this.getEventsTimeInterval(events) : chartTile.dataTimeInterval, // Defaults to Auto / Daily
                  data: data
                }
              });
              break;
            case ChartTypes.IntensityZones:
              chartsAndData.push({
                ...chartTile, ...{
                  timeInterval: TimeIntervals.Auto, // Defaults to Auto
                  data: this.getIntensityZonesChartData(events)
                }
              });
              break;
            default:
              chartsAndData.push({
                ...chartTile, ...{
                  timeInterval: chartTile.dataTimeInterval === TimeIntervals.Auto ? this.getEventsTimeInterval(events) : chartTile.dataTimeInterval, // Defaults to Auto / Daily
                  data: events ? // The below will create a new instance of this events due to filtering
                    this.getChartData(events, chartTile.dataType, chartTile.dataValueType, chartTile.dataCategoryType, chartTile.dataTimeInterval)
                    : [] // We send null if there are no events for the input date range
                }
              });
              break;
          }
          break;
        // Map
        case TileTypes.Map:
          const mapTile = <TileMapSettingsInterface>tile;
          chartsAndData.push({
            ...mapTile, ...{
              events: this.events,
            }
          });
          break;
        default:
          throw new Error(`Not implemented for ${tile.type}`);
      }
      return chartsAndData;
    }, [])
  }

  private unsubscribeFromAll() {
    if (this.chartThemeSubscription) {
      this.chartThemeSubscription.unsubscribe();
    }
  }

  private getValueMinOrMax(events: EventInterface[], dataType: string, min = false): number {
    return events.reduce((minOrMaxBuffer, event) => {
      const stat = event.getStat(dataType);
      // if (!stat || typeof !stat.getValue() === 'number'){
      if (!stat || !isNumber(stat.getValue())) {
        return minOrMaxBuffer;
      }
      return !min ? (<number>stat.getValue() > minOrMaxBuffer ? <number>stat.getValue() : minOrMaxBuffer) : (<number>stat.getValue() <= minOrMaxBuffer ? <number>stat.getValue() : minOrMaxBuffer)
    }, !min ? -Infinity : Infinity);
  }

  private getValueAvg(events: EventInterface[], dataType: string, min = false): number {
    let totalAvgCount = 0;
    const valueSum = events.reduce((sum, event) => {
      const stat = event.getStat(dataType);
      if (!stat || !isNumber(stat.getValue())) {
        return sum;
      }
      totalAvgCount++;
      sum += <number>stat.getValue();
      return sum;
    }, 0);
    return valueSum / totalAvgCount;
  }

  private getValueSum(events: EventInterface[], dataType: string): number {
    return events.reduce((sum, event) => {
      const stat = event.getStat(dataType);
      // if (!stat || typeof !stat.getValue() === 'number'){
      if (!stat || !isNumber(stat.getValue())) {
        return sum;
      }
      sum += <number>stat.getValue();
      return sum;
    }, 0);
  }

  private getChartData(events: EventInterface[], dataType: string, valueType: ChartDataValueTypes, categoryType: ChartDataCategoryTypes, timeInterval: TimeIntervals): SummariesChartDataInterface[] {
    if (this.getChartDataCache[`${dataType}:${valueType}:${categoryType}:${timeInterval}`]) {
      return this.getChartDataCache[`${dataType}:${valueType}:${categoryType}:${timeInterval}`];
    }
    // Return empty if ascent is to be skipped
    if (dataType === DataAscent.type) {
      events = events.filter(event => {
        return event.getActivityTypesAsArray().filter(eventActivityType => this.user.settings.summariesSettings.removeAscentForEventTypes.indexOf(ActivityTypes[eventActivityType]) === -1).length
      })
    }
    // @todo can the below if be better ? we need return there for switch
    // We care sums to ommit 0s
    if (this.getValueSum(events, dataType) === 0 && valueType === ChartDataValueTypes.Total) {
      return []
    }
    // We care min max to ommit infinity etc no need to check for max, if NAN then abort (0 can be max)
    if (!isNumber(this.getValueMinOrMax(events, dataType)) && (valueType === ChartDataValueTypes.Maximum || valueType === ChartDataValueTypes.Minimum)) {
      return []
    }
    // @todo not sure if this is needed
    if (!isNumber(this.getValueAvg(events, dataType)) && valueType === ChartDataValueTypes.Average) {
      return [];
    }

    // Create the map
    const valueByCategory = events.reduce((valueByTypeMap: Map<string | number, { [type: string]: number, count: number }>, event) => {
      const stat = event.getStat(dataType);
      if (!stat) {
        return valueByTypeMap;
      }
      const key = this.getEventCategoryKey(event, events, ChartDataCategoryTypes.ActivityType, timeInterval)
      const summariesChartDataInterface = valueByTypeMap.get(this.getEventCategoryKey(event, events, categoryType, timeInterval))
        || {
        [key]: null,
        [`${key}-Count`]: 0,
        [valueType]: null,
        count: 0
      };
      // Bump em up
      summariesChartDataInterface.count++;
      // additional check here and bump up intentionaly
      summariesChartDataInterface[`${key}-Count`] = summariesChartDataInterface[`${key}-Count`] || 0;
      summariesChartDataInterface[`${key}-Count`] += 1;
      switch (valueType) {
        case ChartDataValueTypes.Maximum:
          summariesChartDataInterface[valueType] = isNumber(summariesChartDataInterface[valueType]) ? (summariesChartDataInterface[valueType] > <number>stat.getValue() ? summariesChartDataInterface[valueType] : <number>stat.getValue()) : <number>stat.getValue();
          summariesChartDataInterface[key] = isNumber(summariesChartDataInterface[key]) ? (summariesChartDataInterface[key] > <number>stat.getValue() ? summariesChartDataInterface[key] : <number>stat.getValue()) : <number>stat.getValue();
          break;
        case ChartDataValueTypes.Minimum:
          summariesChartDataInterface[valueType] = isNumber(summariesChartDataInterface[valueType]) ? (summariesChartDataInterface[valueType] < <number>stat.getValue() ? summariesChartDataInterface[valueType] : <number>stat.getValue()) : <number>stat.getValue();
          summariesChartDataInterface[key] = isNumber(summariesChartDataInterface[key]) ? (summariesChartDataInterface[key] < <number>stat.getValue() ? summariesChartDataInterface[key] : <number>stat.getValue()) : <number>stat.getValue();
          break;
        case ChartDataValueTypes.Average:
        case ChartDataValueTypes.Total:
          summariesChartDataInterface[valueType] = summariesChartDataInterface[valueType] ? summariesChartDataInterface[valueType] + <number>stat.getValue() : <number>stat.getValue();
          summariesChartDataInterface[key] = summariesChartDataInterface[key] ? summariesChartDataInterface[key] + <number>stat.getValue() : <number>stat.getValue();
          break;
        default:
          throw new Error('Not implemented');
      }
      // Last additional check here.
      // If you want to pass nulls this should be removed
      if (!isNumber(summariesChartDataInterface[valueType]) || (summariesChartDataInterface[valueType] === 0 && valueType === ChartDataValueTypes.Total)) {
        return valueByTypeMap;
      }
      if (!isNumber(summariesChartDataInterface[key])) {
        delete summariesChartDataInterface[key];
        delete summariesChartDataInterface[`${key}-Count`];
      }
      valueByTypeMap.set(this.getEventCategoryKey(event, events, categoryType, timeInterval), summariesChartDataInterface); // @todo break the join (not use display value)
      return valueByTypeMap
    }, new Map<string | number, { [type: string]: number, count: number }>());

    if (valueType === ChartDataValueTypes.Average) {
      // Calc avg
      valueByCategory.forEach((item, type) => {
        Object.keys(valueByCategory).forEach((key) => {
          if (!valueByCategory[`${key}-Count`]) {
            return;
          }
          valueByCategory.set(type, {
            ...item, ...{
              count: item.count,
              [key]: item[key] / item[`${key}-Count`]
            }
          })
        })
        valueByCategory.set(type, {
          ...item, ...{
            // [key]: item[valueType] / item.count,
            [valueType]: item[valueType] / item.count,
            count: item.count
          }
        });
      });
    }
    const map = this.convertToCategories(valueByCategory)
    return this.getChartDataCache[`${dataType}:${valueType}:${categoryType}:${timeInterval}`] = map;
  }

  private getIntensityZonesChartData(events: EventInterface[]) {
    if (this.getChartDataCache[ChartTypes.IntensityZones]) {
      return this.getChartDataCache[ChartTypes.IntensityZones];
    }
    this.getChartDataCache[ChartTypes.IntensityZones] = convertIntensityZonesStatsToChartData(events)
    return this.getChartDataCache[ChartTypes.IntensityZones];
  }

  /**
   * Does nothing rather to convert a map to an obj
   * sorry
   * @todo remove/simplify
   * @param valueByType
   */
  private convertToCategories(valueByType: Map<string | number, { [type: string]: number, count: number }>): SummariesChartDataInterface[] {
    const data = [];
    valueByType.forEach((item, type) => {
      data.push({ ...{ time: type, type: type, ...item } });
    });
    return data // @todo ?
    //   .filter(dataItem => isNumber(dataItem.value))
  }

  /**
   * Expects the input to be sorted already
   * @param events
   */
  private getEventsTimeInterval(events?: EventInterface[]): TimeIntervals {
    if (!events || !events.length) {
      return TimeIntervals.Daily
    }
    const startDate = events[0].startDate;
    const endDate = events[events.length - 1].startDate;
    //  Not the same year ? create a year category
    if (endDate.getFullYear() !== startDate.getFullYear()) {
      return TimeIntervals.Yearly;
    }
    // Not the same month ? create a monthly category
    if (endDate.getMonth() !== startDate.getMonth()) {
      // First check if the date range is in 30 day and return daily
      if (endDate.getTime() <= startDate.getTime() + (1000 * 31 * 24 * 60 * 60)) {
        return TimeIntervals.Daily
      }
      return TimeIntervals.Monthly;
    }
    // Not the same day ? Return daily
    if (endDate.getDate() !== startDate.getDate()) {
      return TimeIntervals.Daily;
    }
    // Not the same hour ? Return hourly
    // @todo implement the rest of the cases
    return TimeIntervals.Hourly;
  }

  // @todo refactor
  private getRowHeight() {
    const angle = (window.screen && window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
    return (angle === 90 || angle === -90) ? '40vw' : '40vh';
  }

  private getNumberOfColumns() {
    if (window.innerWidth < 860) {
      return 1;
    }
    if (window.innerWidth < 1500) {
      return 2;
    }
    return 4;
  }
}

export interface SummariesChartDataInterface {
  time?: number,
  type: string,
  value: number,
  count: number
}

export interface SummariesChartTileInterface extends TileChartSettingsInterface {
  timeInterval: TimeIntervals
  data: SummariesChartDataInterface[]
}

export interface SummariesMapTileInterface extends TileMapSettingsInterface {
  events: EventInterface[];
}

export function isSummariesChartTile(tile): tile is SummariesChartTileInterface {
  return 'timeInterval' in tile;
}
