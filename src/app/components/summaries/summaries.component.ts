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
import {EventService} from '../../services/app.event.service';
import {Subscription} from 'rxjs';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {Router} from '@angular/router';
import {MatSnackBar} from '@angular/material/snack-bar';
import {AppAuthService} from '../../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {ChartThemes} from 'quantified-self-lib/lib/users/user.chart.settings.interface';
import {ThemeService} from '../../services/app.theme.service';
import {DataActivityTypes} from 'quantified-self-lib/lib/data/data.activity-types';
import {ActivityTypes} from 'quantified-self-lib/lib/activities/activity.types';
import * as Sentry from '@sentry/browser';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  UserDashboardChartSettingsInterface
} from 'quantified-self-lib/lib/users/user.dashboard.chart.settings.interface';
import {isNumber} from 'quantified-self-lib/lib/events/utilities/helpers';
import {MatDialog} from '@angular/material/dialog';
import {LoadingAbstract} from '../loading/loading.abstract';

@Component({
  selector: 'app-summaries',
  templateUrl: './summaries.component.html',
  styleUrls: ['./summaries.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class SummariesComponent extends LoadingAbstract implements OnInit, OnDestroy, OnChanges {
  @Input() events: EventInterface[];
  @Input() user: User;
  @Input() userChartsSettings: UserDashboardChartSettingsInterface[];

  public rowHeight;
  public numberOfCols;


  public charts: SummariesChartInterface[] = [];
  public chartTypes = ChartTypes;

  private chartThemeSubscription: Subscription;
  private chartTheme: ChartThemes;


  @HostListener('window:resize', ['$event'])
  @HostListener('window:orientationchange', ['$event'])
  resizeOROrientationChange(event?) {
    this.numberOfCols = this.getNumberOfColumns();
    this.rowHeight = this.getRowHeight();
  }

  constructor(private router: Router,
              private authService: AppAuthService,
              private eventService: EventService,
              private themeService: ThemeService,
              private snackBar: MatSnackBar,
              private dialog: MatDialog,
              changeDetector: ChangeDetectorRef,
  ) {
    super(changeDetector);
    this.rowHeight = this.getRowHeight();
    this.numberOfCols = this.getNumberOfColumns();
  }


  ngOnInit() {
  }

  ngOnChanges(simpleChanges: SimpleChanges) {
    if (simpleChanges.events || simpleChanges.userChartsSettings) {
      this.loading();
      this.subscribeToAll();
    }
  }

  private subscribeToAll() {
    this.unsubscribeFromAll();
    // Subscribe to the chartTheme changes
    this.chartThemeSubscription = this.themeService.getChartTheme().subscribe((chartTheme) => {
      this.chartTheme = chartTheme;
    });
    if (this.events) {
      this.events = this.events.filter(event => !event.isMerge).sort((eventA: EventInterface, eventB: EventInterface) => +eventA.startDate - +eventB.startDate)
    }
    this.charts = this.getChartsAndData(this.userChartsSettings, this.events);
    this.loaded();
  }

  private getChartsAndData(userDashboardChartSettings: UserDashboardChartSettingsInterface[], events?: EventInterface[]): SummariesChartInterface[] {
    return userDashboardChartSettings.reduce((chartsAndData: SummariesChartInterface[], chartSettings) => {
      chartsAndData.push({
        ...chartSettings, ...{
          dataDateRange: events && events.length ? this.getEventsDateRange(events) : null,
          data: events ? // The below will create a new instance of this events due to filtering
            this.getChartData(events, chartSettings.dataType, chartSettings.dataValueType, chartSettings.dataCategoryType)
            : null // We send null if there are no events for the input date range
        }
      });
      return chartsAndData;
    }, [])
  }

  private unsubscribeFromAll() {
    if (this.chartThemeSubscription) {
      this.chartThemeSubscription.unsubscribe();
    }
  }

  ngOnDestroy(): void {
    this.unsubscribeFromAll();
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

  private getChartData(events: EventInterface[], dataType: string, valueType: ChartDataValueTypes, categoryType: ChartDataCategoryTypes) {
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
    const valueByCategory = events.reduce((valueByTypeMap: Map<string | number, { value: number, count: number }>, event) => {
      const stat = event.getStat(dataType);
      if (!stat) {
        return valueByTypeMap;
      }
      const summariesChartDataInterface = valueByTypeMap.get(this.getCategoryKey(event, events, categoryType)) ||
        {
          value: null,
          count: 0
        };
      // Bump em up
      summariesChartDataInterface.count++;
      switch (valueType) {
        case ChartDataValueTypes.Maximum:
          summariesChartDataInterface.value = isNumber(summariesChartDataInterface.value) ? (summariesChartDataInterface.value > <number>stat.getValue() ? summariesChartDataInterface.value : <number>stat.getValue()) : <number>stat.getValue();
          break;
        case ChartDataValueTypes.Minimum:
          summariesChartDataInterface.value = isNumber(summariesChartDataInterface.value) ? (summariesChartDataInterface.value < <number>stat.getValue() ? summariesChartDataInterface.value : <number>stat.getValue()) : <number>stat.getValue();
          break;
        case ChartDataValueTypes.Average:
        case ChartDataValueTypes.Total:
          summariesChartDataInterface.value = summariesChartDataInterface.value ? summariesChartDataInterface.value + <number>stat.getValue() : <number>stat.getValue();
          break;
        default:
          throw new Error('Not implemented');
      }
      // Last additional check here.
      // If you want to pass nulls this should be removed
      if (!isNumber(summariesChartDataInterface.value) || (summariesChartDataInterface.value === 0 && valueType === ChartDataValueTypes.Total)) {
        return valueByTypeMap;
      }
      valueByTypeMap.set(this.getCategoryKey(event, events, categoryType), summariesChartDataInterface); // @todo break the join (not use display value)
      return valueByTypeMap
    }, new Map<string, { value: number, count: number }>());


    if (valueType === ChartDataValueTypes.Average) {
      // Calc avg
      valueByCategory.forEach((item, type) => {
        valueByCategory.set(type, {value: item.value / item.count, count: item.count});
      });
    }

    return this.convertToCategories(valueByCategory);
  }

  getCategoryKey(event: EventInterface, events: EventInterface[], categoryType: ChartDataCategoryTypes): string | number {
    switch (categoryType) {
      case ChartDataCategoryTypes.ActivityType:
        const eventTypeDisplayStat = <DataActivityTypes>event.getStat(DataActivityTypes.type);
        // Abort and crash if not found
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
        switch (this.getEventsDateRange(events)) {
          case SummariesChartDataDateRages.Yearly:
            return new Date(event.startDate.getFullYear(), 0).getTime();
          case SummariesChartDataDateRages.Monthly:
            return new Date(event.startDate.getFullYear(), event.startDate.getMonth()).getTime();
          case SummariesChartDataDateRages.Daily:
            return new Date(event.startDate.getFullYear(), event.startDate.getMonth(), event.startDate.getDate()).getTime();
          case SummariesChartDataDateRages.Hourly:
            return new Date(event.startDate.getFullYear(), event.startDate.getMonth(), event.startDate.getDate(), event.startDate.getHours(), event.startDate.getMinutes()).getTime();
          default:
            return event.startDate.getTime()
        }
    }
  }

  /**
   * Does nothing rather to convert a map to an obj pretty much and sorts them
   * sorry
   * @todo remove/simplify
   * @param valueByType
   */
  private convertToCategories(valueByType: Map<string | number, { value: number, count: number }>): SummariesChartDataInterface[] {
    const data = [];
    valueByType.forEach((item, type) => {
      data.push({time: type, type: type, value: item.value, count: item.count})
    });
    return data
      .filter(dataItem => isNumber(dataItem.value))
  }

  /**
   * Expects the input to be sorted already
   * @param events
   */
  private getEventsDateRange(events?: EventInterface[]): SummariesChartDataDateRages {
    const startDate = events[0].startDate;
    const endDate = events[events.length - 1].startDate;
    //  Not the same year ? create a year category
    if (endDate.getFullYear() !== startDate.getFullYear()) {
      return SummariesChartDataDateRages.Yearly;
    }
    // Not the same month ? create a monthly category
    if (endDate.getMonth() !== startDate.getMonth()) {
      // First check if the date range is in 1 month and return daily
      if (endDate.getDate() < startDate.getDate()) {
        return SummariesChartDataDateRages.Daily
      }
      return SummariesChartDataDateRages.Monthly;
    }
    // Not the same day ? Return daily
    if (endDate.getDate() !== startDate.getDate()) {
      return SummariesChartDataDateRages.Daily;
    }
    // Not the same hour ? Return hourly
    // @todo implement the rest of the cases
    return SummariesChartDataDateRages.Hourly;
  }

  // @todo refactor
  private getRowHeight() {
    const angle = (window.screen && window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
    return (angle === 90 || angle === -90) ? '50vw' : '50vh';
  }

  private getNumberOfColumns() {
    if (window.innerWidth < 900) {
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

export interface SummariesChartInterface extends UserDashboardChartSettingsInterface {
  dataDateRange: SummariesChartDataDateRages
  data: SummariesChartDataInterface[]
}

export enum SummariesChartDataDateRages {
  Hourly,
  Daily,
  Monthly,
  Yearly,
}
