import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component, Injectable,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import {ActionButtonService} from '../../services/action-buttons/app.action-button.service';
import {ActionButton} from '../../services/action-buttons/app.action-button';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';
import {MatCard} from '@angular/material/card';
import {MatPaginator, MatPaginatorIntl, PageEvent} from '@angular/material/paginator';
import {MatSnackBar} from '@angular/material/snack-bar';
import {MatSort} from '@angular/material/sort';
import {MatTableDataSource} from '@angular/material/table';
import {SelectionModel} from '@angular/cdk/collections';
import {DatePipe} from '@angular/common';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventUtilities} from 'quantified-self-lib/lib/events/utilities/event.utilities';
import {take} from 'rxjs/operators';
import {User} from 'quantified-self-lib/lib/users/user';
import {Subscription} from 'rxjs';
import * as Sentry from '@sentry/browser';
import {Log} from 'ng2-logger/browser';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {DataAscent} from 'quantified-self-lib/lib/data/data.ascent';
import {DataDescent} from 'quantified-self-lib/lib/data/data.descent';
import {DataEnergy} from 'quantified-self-lib/lib/data/data.energy';
import {DataHeartRateAvg} from 'quantified-self-lib/lib/data/data.heart-rate-avg';
import {rowsAnimation} from '../../animations/animations';
import {DataActivityTypes} from 'quantified-self-lib/lib/data/data.activity-types';
import {DataDeviceNames} from 'quantified-self-lib/lib/data/data.device-names';
import {DeleteConfirmationComponent} from '../delete-confirmation/delete-confirmation.component';
import {MatBottomSheet} from '@angular/material';
import {animate, state, style, transition, trigger} from '@angular/animations';
import {DataRPE, RPEBorgCR10SCale} from 'quantified-self-lib/lib/data/data.rpe';
import {isNumber} from 'quantified-self-lib/lib/events/utilities/helpers';
import {DataFeeling, Feelings} from 'quantified-self-lib/lib/data/data.feeling';
import {UserService} from '../../services/app.user.service';
import {ScreenBreakPoints, ScreenSizeAbstract} from '../screen-size/sreen-size.abstract';


@Component({
  selector: 'app-event-table',
  templateUrl: './event.table.component.html',
  styleUrls: ['./event.table.component.css'],
  animations: [
    rowsAnimation,
    trigger('detailExpand', [
      state('collapsed, void', style({height: '0px', minHeight: '0', display: 'none'})),
      state('expanded', style({height: '*'})),
      transition('expanded <=> collapsed', animate('225ms cubic-bezier(0.4, 0.0, 0.2, 1)')),
      transition('expanded <=> void', animate('225ms cubic-bezier(0.4, 0.0, 0.2, 1)'))
    ]),
  ],
  providers: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventTableComponent extends ScreenSizeAbstract implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  @Input() user: User;
  @Input() events: EventInterface[];
  @ViewChild(MatSort, {static: true}) sort: MatSort;
  @ViewChild(MatPaginator, {static: true}) paginator: MatPaginator;
  @ViewChild(MatCard, {static: true}) table: MatCard;

  private deleteConfirmationSubscription: Subscription;
  private sortSubscription: Subscription;

  private logger = Log.create('EventTableComponent');

  data: MatTableDataSource<any> = new MatTableDataSource<EventRowElement>();
  selection = new SelectionModel(true, []);
  expandedElement: EventRowElement | null;
  expandAll: boolean;
  rpeBorgCR10SCale = RPEBorgCR10SCale;
  feelings = Feelings;

  eventSelectionMap: Map<EventInterface, boolean> = new Map<EventInterface, boolean>();

  // isExpansionDetailRow = (i: number, row: Object) => row.hasOwnProperty('detailRow');


  constructor(private snackBar: MatSnackBar,
              private eventService: EventService,
              private actionButtonService: ActionButtonService,
              private deleteConfirmationBottomSheet: MatBottomSheet,
              private userService: UserService,
              changeDetector: ChangeDetectorRef,
              private router: Router, private  datePipe: DatePipe) {
    super(changeDetector);
  }



  ngOnChanges(simpleChanges: SimpleChanges): void {
    if (!this.events || !this.user) {
      this.loading();
      return;
    }
    if (this.events && simpleChanges.events) {
      this.processChanges();
    }
    if (this.user && simpleChanges.user) {
      this.paginator._changePageSize(this.user.settings.dashboardSettings.tableSettings.eventsPerPage);
    }
    this.loaded();
  }

  ngOnInit(): void {
  }

  ngAfterViewInit() {
    this.data.paginator = this.paginator;
    this.data.sort = this.sort;
    this.data.sortingDataAccessor = (eventRowElement: EventRowElement, header) => {
      return eventRowElement[`sort.${header}`];
    };
    this.sortSubscription = this.sort.sortChange.subscribe((sort) => {
      if (this.user.settings.dashboardSettings.tableSettings.active !== sort.active || this.user.settings.dashboardSettings.tableSettings.direction !== sort.direction) {
        this.user.settings.dashboardSettings.tableSettings.active = sort.active;
        this.user.settings.dashboardSettings.tableSettings.direction = sort.direction;
        this.userService.updateUserProperties(this.user, {settings: this.user.settings})
      }
    });
  }

  checkBoxClick(row) {
    this.selection.toggle(row);
    this.updateActionButtonService();
  }

  /** Whether the number of selected elements matches the total number of rows. */
  isAllSelected() {
    const numSelected = this.selection.selected.length;
    const numRows = this.data.data.length;
    return numSelected === numRows;
  }


  /** Selects all rows if they are not all selected; otherwise clear selection. */
  masterToggle() {
    this.isAllSelected() ?
      this.selection.clear() :
      this.data.data.forEach(row => this.selection.select(row));
    this.updateActionButtonService();
  }

  getColumnHeaderIcon(columnName): string {
    switch (columnName) {
      case 'Distance':
        return 'trending_flat';
      case 'Duration':
        return 'timer';
      case 'startDate':
        return 'date_range';
      case 'Device Names':
        return 'watch';
      case 'name':
        return 'font_download';
      case 'Activity Types':
        return 'filter_none';
      case 'privacy':
        return 'visibility';
      default:
        return null;
    }
  }

  getColumnHeaderSVGIcon(columnName): string {
    switch (columnName) {
      case 'Ascent':
        return 'arrow_up_right';
      case 'Descent':
        return 'arrow_down_right';
      case 'Average Heart Rate':
        return 'heart_rate';
      case 'Energy':
        return 'energy';
      default:
        return null;
    }
  }

  isColumnHeaderSortable(columnName): boolean {
    return ['startDate', 'Distance', 'Activity Types', 'Duration', 'Ascent', 'Descent', 'Average Heart Rate', 'Energy', 'Device Names'].indexOf(columnName) !== -1;
  }


  private processChanges() {
    // this.data = new MatTableDataSource<any>(data);
    this.data.data = this.events.reduce((EventRowElementsArray, event) => {
      if (!event) {
        return EventRowElementsArray;
      }

      const dataObject: EventRowElement = <EventRowElement>{};
      const ascent = event.getStat(DataAscent.type);
      const descent = event.getStat(DataDescent.type);
      const energy = event.getStat(DataEnergy.type);
      const heartRateAverage = event.getStat(DataHeartRateAvg.type);
      const eventRPE = event.getStat(DataRPE.type);
      const eventFeeling = event.getStat(DataFeeling.type);

      dataObject.privacy = event.privacy;
      dataObject.name = event.name;
      dataObject.startDate = (event.startDate instanceof Date && !isNaN(+event.startDate)) ? this.datePipe.transform(event.startDate, 'EEEEEE d MMM yy HH:mm') : 'None?';

      const activityTypes = event.getStat(DataActivityTypes.type) || new DataActivityTypes(['Not found']);
      dataObject['Activity Types'] = event.getActivityTypesAsString();

      dataObject['Distance'] = `${event.getDistance().getDisplayValue()} ${event.getDistance().getDisplayUnit()}`;
      dataObject['Ascent'] = ascent ? `${ascent.getDisplayValue()} ${ascent.getDisplayUnit()}` : '';
      dataObject['Descent'] = descent ? `${descent.getDisplayValue()} ${descent.getDisplayUnit()}` : '';
      dataObject['Energy'] = energy ? `${energy.getDisplayValue()} ${energy.getDisplayUnit()}` : '';
      dataObject['Average Heart Rate'] = heartRateAverage ? `${heartRateAverage.getDisplayValue()} ${heartRateAverage.getDisplayUnit()}` : '';
      dataObject['Duration'] = event.getDuration().getDisplayValue();
      dataObject['isMerge'] = event.isMerge;
      dataObject.description = event.description;
      const deviceNames = event.getStat(DataDeviceNames.type) || new DataDeviceNames(['Not found']);
      dataObject['Device Names'] = event.getDeviceNamesAsString();
      if (eventRPE) {
        dataObject.rpe = <RPEBorgCR10SCale>eventRPE.getValue();
      }
      if (eventFeeling) {
        dataObject.feeling = <Feelings>eventFeeling.getValue();
      }
      dataObject.event = event;

      // Add the sorts
      dataObject['sort.startDate'] = event.startDate.getTime();
      dataObject['sort.Activity Types'] = dataObject['Activity Types'];
      dataObject['sort.Distance'] = event.getDistance().getValue() || 0;
      dataObject['sort.Ascent'] = ascent ? <number>ascent.getValue() : 0;
      dataObject['sort.Descent'] = descent ? <number>descent.getValue() : 0;
      dataObject['sort.Energy'] = energy ? <number>energy.getValue() : 0;
      dataObject['sort.Duration'] = event.getDuration().getValue() || 0;
      dataObject['sort.Average Heart Rate'] = heartRateAverage ? <number>heartRateAverage.getValue() : 0; // Check for null if better
      dataObject['sort.Device Names'] = dataObject['Device Names'];

      EventRowElementsArray.push(dataObject);
      return EventRowElementsArray;
    }, [])
    // this.data.paginator = this.paginator;
    // this.data.sort = this.sort;
    //
    // this.data.sortingDataAccessor = (eventRowElement: EventRowElement, header) => {
    //   return eventRowElement[`sort.${header}`];
    // };

  }

  private updateActionButtonService() {
    // Remove all at start and add progressively
    this.actionButtonService.removeActionButton('mergeEvents');
    this.actionButtonService.removeActionButton('deleteEvents');

    if (this.selection.selected.length > 1) {
      this.actionButtonService.addActionButton('mergeEvents', new ActionButton(
        'compare_arrows',
        async () => {
          // Show loading
          this.loading();
          // Remove all subscriptions
          this.unsubscribeFromAll();
          // Clear all selections
          this.actionButtonService.removeActionButton('mergeEvents');
          this.actionButtonService.removeActionButton('deleteEvents');
          // First fetch them complete
          const promises: Promise<EventInterface>[] = [];
          this.selection.selected.forEach((selected) => {
            promises.push(this.eventService.getEventActivitiesAndStreams(this.user, selected.event.getID()).pipe(take(1)).toPromise());
          });
          // Now we can clear the selection
          this.eventSelectionMap.clear();
          this.selection.clear();
          const events = await Promise.all(promises);
          const mergedEvent = EventUtilities.mergeEvents(events);
          try {
            await this.eventService.setEvent(this.user, mergedEvent);
            await this.router.navigate(['/user', this.user.uid, 'event', mergedEvent.getID()], {});
            this.snackBar.open('Events merged', null, {
              duration: 2000,
            });
          } catch (e) {
            Sentry.withScope(scope => {
              scope.setExtra('data_event', mergedEvent.toJSON());
              mergedEvent.getActivities().forEach((activity, index) => scope.setExtra(`data_activity${index}`, activity.toJSON()));
              // will be tagged with my-tag="my value"
              Sentry.captureException(e);
              this.processChanges();
              this.loaded();
            });
            this.snackBar.open('Could not merge events', null, {
              duration: 5000,
            });
          }
        },
        'material',
      ));
    }

    if (this.selection.selected.length > 0) {
      this.actionButtonService.addActionButton('deleteEvents', new ActionButton(
        'delete',
        async () => {
          this.loading();
          const deleteConfirmationBottomSheet = this.deleteConfirmationBottomSheet.open(DeleteConfirmationComponent);
          this.deleteConfirmationSubscription = deleteConfirmationBottomSheet.afterDismissed().subscribe(async (result) => {
            if (!result) {
              this.loaded();
              return;
            }
            this.actionButtonService.removeActionButton('deleteEvents');
            this.actionButtonService.removeActionButton('mergeEvents');
            this.unsubscribeFromAll();
            const deletePromises = [];
            this.selection.selected.map(selected => selected.event).forEach((event) => deletePromises.push(this.eventService.deleteAllEventData(this.user, event.getID())));
            this.eventSelectionMap.clear();
            this.selection.clear();
            await Promise.all(deletePromises);
            this.processChanges();
            this.snackBar.open('Events deleted', null, {
              duration: 2000,
            });
          });
          return;

        },
        'material',
      ));
    }
  }

  async saveEventDescription(description: string, event: EventInterface) {
    event.description = description;
    await this.eventService.setEvent(this.user, event);
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }

  async saveEventName(name: string, event: EventInterface) {
    event.name = name;
    await this.eventService.setEvent(this.user, event);
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }

  async saveEventRPE(rpe: RPEBorgCR10SCale, event: EventInterface) {
    if (!isNumber(rpe)) {
      return;
    }
    event.addStat(new DataRPE(rpe));
    await this.eventService.setEvent(this.user, event);
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }

  async saveEventFeeling(feeling: Feelings, event: EventInterface) {
    if (!isNumber(feeling)) {
      return;
    }
    event.addStat(new DataFeeling(feeling));
    await this.eventService.setEvent(this.user, event);
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }

  getEnumKeyValue(enumerator) {
    return Object.keys(enumerator).slice(Object.keys(enumerator).length / 2)
      .reduce((obj, key) => {
        obj[`${enumerator[key]} - ${key}`] = enumerator[key];
        return obj
      }, {});
  }

  getColumnsToDisplayDependingOnScreenSize(event?) {
    let columns = ['expand'];


    // push all the rest
    columns.push(...[
      'checkbox',
      'startDate',
      'Activity Types',
      'Distance',
      'Ascent',
      'Descent',
      'Energy',
      'Average Heart Rate',
      'Duration',
      'Device Names',
      'Actions'
    ]);

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Highest){
      return columns;
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.VeryHigh) {
      columns = columns.filter(column => ['Energy'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.High) {
      columns = columns.filter(column => ['Energy', 'Average Heart Rate'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Moderate) {
      columns = columns.filter(column => ['Energy', 'Average Heart Rate', 'Descent'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Low) {
      columns = columns.filter(column => ['Energy', 'Average Heart Rate', 'Descent', 'Device Names'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.VeryLow) {
      columns = columns.filter(column => ['Energy', 'Average Heart Rate', 'Descent', 'Device Names', 'Ascent'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Lowest) {
      columns = columns.filter(column => ['Energy', 'Average Heart Rate', 'Descent', 'Device Names', 'Ascent', 'Descent'].indexOf(column) === -1)
    }

    return columns
  }

  private unsubscribeFromAll() {
    if (this.deleteConfirmationSubscription) {
      this.deleteConfirmationSubscription.unsubscribe();
    }
  }

  async pageChanges(pageEvent: PageEvent) {
    this.user.settings.dashboardSettings.tableSettings.eventsPerPage = pageEvent.pageSize;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  applyFilter(event) {
    this.data.filter = event.target.value.trim().toLowerCase();
  }

  ngOnDestroy() {
    this.unsubscribeFromAll();
    this.actionButtonService.removeActionButton('mergeEvents');
    this.actionButtonService.removeActionButton('deleteEvents');
  }
}


export interface EventRowElement {
  event: EventInterface,
  privacy: Privacy,
  name: string,
  startDate: String,
  'Activity Types': string,
  'Distance': string,
  'Ascent': string,
  'Descent': string,
  'Average Heart Rate': string,
  'Duration': string,
  'Energy': string,
  'Device Names': string,
  // And their sortable data
  'sort.startDate': number,
  'sort.Activity Types': string,
  'sort.Distance': number,
  'sort.Ascent': number,
  'sort.Descent': number,
  'sort.Energy': number,
  'sort.Average Heart Rate': number,
  'sort.Duration': number,
  'sort.Device Names': string,
  isMerge: boolean,
  actions: boolean,
  description: string,
  rpe?: RPEBorgCR10SCale,
  feeling?: Feelings,
}

@Injectable()
export class MatPaginatorIntlFireStore extends MatPaginatorIntl {
  itemsPerPageLabel = 'Items';
  nextPageLabel = 'Next';
  previousPageLabel = 'Previous';

  // getRangeLabel = (page: number, pageSize: number, length: number): string => {
  //   debugger;
  //   if (length === (page + 2) * pageSize) {
  //     return `${page * pageSize} - ${(page + 1) * pageSize}`
  //   }
  //
  //   return `${page * pageSize} - ${length} `
  // }
}
