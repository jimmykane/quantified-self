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
import {debounceTime, take} from 'rxjs/operators';
import {User} from 'quantified-self-lib/lib/users/user';
import {Subject, Subscription} from 'rxjs';
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
import {EnumeratorHelpers} from '../../helpers/enumerator-helpers';
import {DataPowerAvg} from 'quantified-self-lib/lib/data/data.power-avg';
import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {DataSpeedAvg} from 'quantified-self-lib/lib/data/data.speed-avg';
import {ActivityTypes, ActivityTypesHelper} from 'quantified-self-lib/lib/activities/activity.types';
import {DataTableAbstract} from '../data-table/data-table.abstract';


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

export class EventTableComponent extends DataTableAbstract implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  @Input() user: User;
  @Input() events: EventInterface[];
  @ViewChild(MatSort, {static: true}) sort: MatSort;
  @ViewChild(MatPaginator, {static: true}) paginator: MatPaginator;
  @ViewChild(MatCard, {static: true}) table: MatCard;

  data: MatTableDataSource<any> = new MatTableDataSource<EventRowElement>();
  selection = new SelectionModel(true, []);
  expandedElement: EventRowElement | null;
  expandAll: boolean;

  feeling: Feelings;
  rpe: RPEBorgCR10SCale;
  feelings = EnumeratorHelpers.getNumericEnumKeyValue(Feelings);
  rpeBorgCR10SCale = EnumeratorHelpers.getNumericEnumKeyValue(RPEBorgCR10SCale);

  private deleteConfirmationSubscription: Subscription;
  private sortSubscription: Subscription;

  private logger = Log.create('EventTableComponent');
  private searchSubject: Subject<string> = new Subject();


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
    this.logger.info(`ngOnChanges`);
    if (!this.events) {
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
    if (!this.user) {
      throw new Error(`Component needs user`)
    }
    this.searchSubject.pipe(
      debounceTime(500)
    ).subscribe(searchTextValue => {
      this.search(searchTextValue);
    });
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

  isColumnHeaderSortable(columnName): boolean {
    return ['startDate', 'Distance', 'Activity Types', 'Average Power','Average Speed', 'Duration', 'Ascent', 'Descent', 'Average Heart Rate', 'Energy', 'Device Names'].indexOf(columnName) !== -1;
  }


  private processChanges() {
    this.logger.info(`Processing changes`)
    // this.data = new MatTableDataSource<any>(data);
    this.data.data = this.events.reduce((EventRowElementsArray, event) => {
      if (!event) {
        return EventRowElementsArray;
      }

      const dataObject: EventRowElement = <EventRowElement>{};
      const ascent = event.getStat(DataAscent.type);
      const descent = event.getStat(DataDescent.type);
      const energy = event.getStat(DataEnergy.type);
      const avgPower = event.getStat(DataPowerAvg.type);
      const avgSpeed = event.getStat(DataSpeedAvg.type);
      const heartRateAverage = event.getStat(DataHeartRateAvg.type);
      const eventRPE = event.getStat(DataRPE.type);
      const eventFeeling = event.getStat(DataFeeling.type);

      dataObject.privacy = event.privacy;
      dataObject.name = event.name;
      dataObject.startDate = (event.startDate instanceof Date && !isNaN(+event.startDate)) ? this.datePipe.transform(event.startDate, 'EEEEEE d MMM yy HH:mm') : 'None?';

      const activityTypes = <DataActivityTypes>event.getStat(DataActivityTypes.type); // @todo check if this breaks
      dataObject['Activity Types'] = event.getActivityTypesAsString();

      dataObject['Distance'] = `${event.getDistance().getDisplayValue()} ${event.getDistance().getDisplayUnit()}`;
      dataObject['Ascent'] = ascent ? `${ascent.getDisplayValue()} ${ascent.getDisplayUnit()}` : '';
      dataObject['Descent'] = descent ? `${descent.getDisplayValue()} ${descent.getDisplayUnit()}` : '';
      dataObject['Energy'] = energy ? `${energy.getDisplayValue()} ${energy.getDisplayUnit()}` : '';
      // ActivityTypesHelper.averageSpeedDerivedMetricsToUseForActivityType(ActivityTypes[activityType]).
      dataObject['Average Speed'] =  activityTypes.getValue().reduce((accu, activityType) => {
        return [...accu, ...ActivityTypesHelper.averageSpeedDerivedMetricsToUseForActivityType(ActivityTypes[activityType])]
      }, []).reduce((accu, dataType) => {
        const stat = event.getStat(dataType);
        return stat ?
          [...accu, ...DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, this.user.settings.unitSettings)]
          : accu
      }, []).reduce((avs, data) => {
        avs.push(`${data.getDisplayValue()}${data.getDisplayUnit()}`);
        return avs;
      }, []).join(', ');
      dataObject['Average Power'] = avgPower ? `${avgPower.getDisplayValue()} ${avgPower.getDisplayUnit()}` : '';
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
      dataObject['sort.Average Speed'] = avgSpeed ? <number>avgSpeed.getValue() : 0;
      dataObject['sort.Average Power'] = avgPower ? <number>avgPower.getValue() : 0;
      dataObject['sort.Duration'] = event.getDuration().getValue() || 0;
      dataObject['sort.Average Heart Rate'] = heartRateAverage ? <number>heartRateAverage.getValue() : 0; // Check for null if better
      dataObject['sort.Device Names'] = dataObject['Device Names'];

      EventRowElementsArray.push(dataObject);
      return EventRowElementsArray;
    }, []);
    // this.data.paginator = this.paginator;
    // this.data.sort = this.sort;
    //
    // this.data.sortingDataAccessor = (eventRowElement: EventRowElement, header) => {
    //   return eventRowElement[`sort.${header}`];
    // };
    this.logger.info(`Changes processed`);
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

  private unsubscribeFromAll() {
    if (this.deleteConfirmationSubscription) {
      this.deleteConfirmationSubscription.unsubscribe();
    }
    if (this.sortSubscription){
      this.sortSubscription.unsubscribe();
    }
  }

  async pageChanges(pageEvent: PageEvent) {
    this.user.settings.dashboardSettings.tableSettings.eventsPerPage = pageEvent.pageSize;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  search(searchTerm) {
    this.data.filter = searchTerm.trim().toLowerCase();
  }

  onKeyUp(event) {
    this.searchSubject.next(event.target.value);
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
  'Average Speed': string,
  'Average Power': string,
  'Device Names': string,
  // And their sortable data
  'sort.startDate': number,
  'sort.Activity Types': string,
  'sort.Distance': number,
  'sort.Ascent': number,
  'sort.Descent': number,
  'sort.Energy': number,
  'sort.Average Power': number,
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
