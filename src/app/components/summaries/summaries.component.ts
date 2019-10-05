import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit, SimpleChanges,
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
  ChartTypes,
  ChartDataValueTypes,
  UserDashboardChartSettingsInterface
} from 'quantified-self-lib/lib/users/user.dashboard.chart.settings.interface';
import WhereFilterOp = firebase.firestore.WhereFilterOp;
import {isNumber} from 'quantified-self-lib/lib/events/utilities/helpers';
import {EventFormComponent} from '../event-form/event.form.component';
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
    if (simpleChanges.events || simpleChanges.user) {
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
    this.charts = this.getChartsAndData(this.events, this.user.settings.dashboardSettings.chartsSettings);
    this.loaded();
  }

  private getChartsAndData(events: EventInterface[], userDashboardChartSettings: UserDashboardChartSettingsInterface[]): SummariesChartInterface[] {
    return userDashboardChartSettings.reduce((chartsAndData: SummariesChartInterface[], chartSettings) => {
      chartsAndData.push({...chartSettings, ...{data: this.getChartDataForDataTypeAndDataValueType(events, chartSettings.dataType, chartSettings.dataValueType)}});
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

  getChartDataForDataTypeAndDataValueType(events: EventInterface[], dataType: string, dataValueType: ChartDataValueTypes) {
    if (!this.events) {
      return null;
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
      if (!stat || !isNumber(stat.getValue())) {
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
      if (!isNumber(stat.getValue())){
        return valueByTypeMap;
      }
      const activityTypeValue = valueByTypeMap.get(eventTypeDisplay.getValue().length > 1 ? ActivityTypes.Multisport : ActivityTypes[eventTypeDisplay.getDisplayValue()]);
      valueByTypeMap.set(eventTypeDisplay.getValue().length > 1 ? ActivityTypes.Multisport : ActivityTypes[eventTypeDisplay.getDisplayValue()], !isNumber(activityTypeValue) ? <number>stat.getValue() : !min ? (activityTypeValue > <number>stat.getValue() ? activityTypeValue : <number>stat.getValue()) : (activityTypeValue <= <number>stat.getValue() ? activityTypeValue : <number>stat.getValue())); // @todo break the join (not use display value)
      return valueByTypeMap
    }, new Map<string, number>());
    return this.convertToCategories(valueByType);
  }

  private getChartDataForDataTypeSum(events: EventInterface[], dataType: string) {
    const valueSum = this.events.reduce((sum, event) => {
      const stat = event.getStat(dataType);
      // if (!stat || typeof !stat.getValue() === 'number'){
      if (!stat || !isNumber(stat.getValue())) {
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
      const activityTypeValue = valueByTypeMap.get(eventTypeDisplay.getValue().length > 1 ? ActivityTypes.Multisport : ActivityTypes[eventTypeDisplay.getDisplayValue()]) || 0;
      if (!isNumber(activityTypeValue) || !isNumber(stat.getValue()) || stat.getValue() === 0) { // Remove 0 values from sums for categories
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
      if (!stat || !isNumber(stat.getValue())) {
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
      if (!isNumber(stat.getValue())){
        return valueByTypeMap;
      }
      const activityTypeValue = valueByTypeMap.get(eventTypeDisplay.getValue().length > 1 ? ActivityTypes.Multisport : ActivityTypes[eventTypeDisplay.getDisplayValue()]) || 0;
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
