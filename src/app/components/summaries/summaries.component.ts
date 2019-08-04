import {Component, HostListener, Input, OnChanges, OnDestroy, OnInit,} from '@angular/core';
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
  ChartTypes,
  ChartDataValueTypes,
  UserDashboardChartSettingsInterface
} from 'quantified-self-lib/lib/users/user.dashboard.chart.settings.interface';
import WhereFilterOp = firebase.firestore.WhereFilterOp;
import {isNumber} from 'quantified-self-lib/lib/events/utilities/helpers';

@Component({
  selector: 'app-summaries',
  templateUrl: './summaries.component.html',
  styleUrls: ['./summaries.component.css'],
  // changeDetection: ChangeDetectionStrategy.OnPush,
})

export class SummariesComponent implements OnInit, OnDestroy, OnChanges {
  @Input() searchTerm: string;
  @Input() searchStartDate: Date;
  @Input() searchEndDate: Date;
  @Input() user: User;

  public rowHeight;
  public numberOfCols;

  public isLoading = true;
  public events: EventInterface[];

  public charts: SummariesChartInterface[] = [];
  public chartTypes = ChartTypes;

  private eventsSubscription: Subscription;
  private chartThemeSubscription: Subscription;
  private chartTheme: ChartThemes;


  @HostListener('window:resize', ['$event'])
  @HostListener('window:orientationchange', ['$event'])
  resizeOROrientationChange(event?) {
    this.numberOfCols = this.getNumberOfColumns();
    this.rowHeight = this.getRowHeight();
  }

  constructor(private router: Router, private authService: AppAuthService, private eventService: EventService, private themeService: ThemeService, private snackBar: MatSnackBar) {
    this.rowHeight = this.getRowHeight();
    this.numberOfCols = this.getNumberOfColumns();
  }


  ngOnInit() {
  }

  ngOnChanges() {
    this.subscribeToAll()
  }

  private subscribeToAll() {
    this.unsubscribeFromAll();
    this.isLoading = true;
    // Subscribe to the chartTheme changes
    this.chartThemeSubscription = this.themeService.getChartTheme().subscribe((chartTheme) => {
      this.chartTheme = chartTheme;
    });
    const limit = 0; // @todo double check this how it relates
    const where = [];
    if (this.searchTerm) {
      where.push({
        fieldPath: 'name',
        opStr: <WhereFilterOp>'==',
        value: this.searchTerm
      });
    }
    if (!this.searchStartDate || !this.searchEndDate) {
      const error = new Error(`Search startDate or endDate are missing`);
      Sentry.captureException(error);
      throw error;
    }
    // this.searchStartDate.setHours(0, 0, 0, 0); // @todo this should be moved to the search component
    where.push({
      fieldPath: 'startDate',
      opStr: <WhereFilterOp>'>=',
      value: this.searchStartDate.getTime() // Should remove mins from date
    });
    // this.searchEndDate.setHours(24, 0, 0, 0);
    where.push({
      fieldPath: 'startDate',
      opStr: <WhereFilterOp>'<=', // Should remove mins from date
      value: this.searchEndDate.getTime()
    });

    this.eventsSubscription = this.eventService.getEventsForUserBy(this.user, where, 'startDate', false, limit).subscribe(events => {
      this.events = events.filter(event => !event.isMerge);
      this.charts = this.getChartsAndData(this.events, this.user.settings.dashboardSettings.chartsSettings);
      this.isLoading = false;
    });
  }

  private getChartsAndData(events: EventInterface[], userDashboardChartSettings: UserDashboardChartSettingsInterface[]): SummariesChartInterface[] {
    return userDashboardChartSettings.reduce((chartsAndData: SummariesChartInterface[], chartSettings) => {
      chartsAndData.push({...chartSettings, ...{data: this.getChartDataForDataTypeAndDataValueType(events, chartSettings.dataType, chartSettings.dataValueType)}});
      return chartsAndData;
    }, [])
  }

  private unsubscribeFromAll() {
    if (this.eventsSubscription) {
      this.eventsSubscription.unsubscribe();
    }
  }

  ngOnDestroy(): void {
    this.unsubscribeFromAll();
  }

  getChartDataForDataTypeAndDataValueType(events: EventInterface[], dataType: string, dataValueType: ChartDataValueTypes) {
    if (!this.events) {
      return [];
    }
    if (dataValueType === ChartDataValueTypes.Total) {
      return this.getChartDataForDataTypeSum(events, dataType);
    }
    if (dataValueType === ChartDataValueTypes.Maximum) {
      return this.getChartDataForDataTypeMax(events, dataType);
    }
    if (dataValueType === ChartDataValueTypes.Minimum) {
      return this.getChartDataForDataTypeMin(events, dataType);
    }
    if (dataValueType === ChartDataValueTypes.Average) {
      return this.getChartDataForDataTypeAvg(events, dataType);
    }
  }

  private getChartDataForDataTypeMax(events: EventInterface[], dataType: string) {
    return this.getChartDataForDataTypeMinOrMax(events, dataType, false);
  }

  private getChartDataForDataTypeMin(events: EventInterface[], dataType: string) {
    return this.getChartDataForDataTypeMinOrMax(events, dataType, true);
  }

  private getChartDataForDataTypeMinOrMax(events: EventInterface[], dataType: string, min) {
    const minOrMax = this.events.reduce((minOrMaxBuffer, event) => {
      const stat = event.getStat(dataType);
      // if (!stat || typeof !stat.getValue() === 'number'){
      if (!stat) {
        return minOrMaxBuffer;
      }
      return !min ? (<number>stat.getValue() > minOrMaxBuffer ? <number>stat.getValue() : minOrMaxBuffer) : (<number>stat.getValue() <= minOrMaxBuffer ? <number>stat.getValue() : minOrMaxBuffer)
    }, !min ? -Infinity : Infinity);

    if (!isNumber(minOrMax)) {
      return []
    }

    // Create the map
    const valueByType = this.events.reduce((valueByTypeMap: Map<string, number>, event) => {
      const eventTypeDisplay = <DataActivityTypes>event.getStat(DataActivityTypes.type);
      const stat = event.getStat(dataType);
      if (!eventTypeDisplay || !stat) {
        return valueByTypeMap;
      }
      if (eventTypeDisplay.getValue().length === 1 && !ActivityTypes[eventTypeDisplay.getDisplayValue()]) {
        Sentry.captureException(new Error(`Activity type with ${eventTypeDisplay.getDisplayValue()} is not known`));
      }
      const activityTypeValue = valueByTypeMap.get(ActivityTypes[eventTypeDisplay.getDisplayValue()]);
      valueByTypeMap.set(eventTypeDisplay.getValue().length > 1 ? ActivityTypes.Multisport : ActivityTypes[eventTypeDisplay.getDisplayValue()], !isNumber(activityTypeValue) ? <number>stat.getValue() : !min ? (activityTypeValue > <number>stat.getValue() ? activityTypeValue : <number>stat.getValue()) : (activityTypeValue <= <number>stat.getValue() ? activityTypeValue : <number>stat.getValue())); // @todo break the join (not use display value)
      return valueByTypeMap
    }, new Map<string, number>());
    return this.convertToCategories(valueByType);
  }

  private getChartDataForDataTypeSum(events: EventInterface[], dataType: string) {
    const valueSum = this.events.reduce((sum, event) => {
      const stat = event.getStat(dataType);
      // if (!stat || typeof !stat.getValue() === 'number'){
      if (!stat) {
        return sum;
      }
      sum += <number>stat.getValue();
      return sum;
    }, 0);

    if (valueSum === 0) {
      return []
    }

    // Create the map
    const valueByType = this.events.reduce((valueByTypeMap: Map<string, number>, event) => {
      const eventTypeDisplay = <DataActivityTypes>event.getStat(DataActivityTypes.type);
      const stat = event.getStat(dataType);
      if (!eventTypeDisplay || !stat) {
        return valueByTypeMap;
      }
      if (eventTypeDisplay.getValue().length === 1 && !ActivityTypes[eventTypeDisplay.getDisplayValue()]) {
        Sentry.captureException(new Error(`Activity type with ${eventTypeDisplay.getDisplayValue()} is not known`));
      }
      const activityTypeValue = valueByTypeMap.get(ActivityTypes[eventTypeDisplay.getDisplayValue()]) || 0;
      if (!activityTypeValue && !stat.getValue()) { // delib include 0 to wipe out from sums
        return valueByTypeMap;
      }
      valueByTypeMap.set(eventTypeDisplay.getValue().length > 1 ? ActivityTypes.Multisport : ActivityTypes[eventTypeDisplay.getDisplayValue()], activityTypeValue + <number>stat.getValue()); // @todo break the join (not use display value)
      return valueByTypeMap
    }, new Map<string, number>());
    return this.convertToCategories(valueByType);
  }

  private getChartDataForDataTypeAvg(events: EventInterface[], dataType: string) {
    let totalAvgCount = 0;
    const valueSum = this.events.reduce((sum, event) => {
      const stat = event.getStat(dataType);
      if (!stat) {
        return sum;
      }
      totalAvgCount++;
      sum += <number>stat.getValue();
      return sum;
    }, 0);

    if (totalAvgCount === 0) {
      return []
    }

    const valueAvg = valueSum / totalAvgCount;


    // Create the map with the sums and a map with the counts
    const valueCountByType = new Map<string, number>();
    const valueSumByType = this.events.reduce((valueByTypeMap: Map<string, number>, event) => {
      const eventTypeDisplay = <DataActivityTypes>event.getStat(DataActivityTypes.type);
      const stat = event.getStat(dataType);
      if (!eventTypeDisplay || !stat) {
        return valueByTypeMap;
      }
      if (eventTypeDisplay.getValue().length === 1 && !ActivityTypes[eventTypeDisplay.getDisplayValue()]) {
        Sentry.captureException(new Error(`Activity type with ${eventTypeDisplay.getDisplayValue()} is not known`));
      }
      const activityTypeValue = valueByTypeMap.get(ActivityTypes[eventTypeDisplay.getDisplayValue()]) || 0;
      const activityTypeValueCount = valueCountByType.get(ActivityTypes[eventTypeDisplay.getDisplayValue()]) || 0;
      valueCountByType.set(eventTypeDisplay.getValue().length > 1 ? ActivityTypes.Multisport : ActivityTypes[eventTypeDisplay.getDisplayValue()], activityTypeValueCount + 1)
      valueByTypeMap.set(eventTypeDisplay.getValue().length > 1 ? ActivityTypes.Multisport : ActivityTypes[eventTypeDisplay.getDisplayValue()], activityTypeValue + <number>stat.getValue()); // @todo break the join (not use display value)
      return valueByTypeMap
    }, new Map<string, number>());

    valueSumByType.forEach((value, type) => {
      valueSumByType.set(type, value / valueCountByType.get(type));
    });

    return this.convertToCategories(valueSumByType);
  }

  private convertToCategories(valueByType: Map<string, number>): any[] {
    const data = [];
    valueByType.forEach((value, type) => {
      data.push({type: type, value: value})
    });
    return data
      .filter(dataItem => isNumber(dataItem.value))
      .sort((dataItemA, dataItemB) => {
        return dataItemA.value - dataItemB.value;
      });
  }

  private getRowHeight() {
    const angle = (window.screen && window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
    return (angle === 90 || angle === -90) ? '30vw' : '30vh';
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

export interface SummariesChartInterface extends UserDashboardChartSettingsInterface {
  data: any[]
}
