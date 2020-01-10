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
import {DataTableAbstract, StatRowElement} from '../data-table/data-table.abstract';
import {AngularFireAnalytics} from '@angular/fire/analytics';


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
  @Input() isLoading: boolean;
  @ViewChild(MatSort, {static: true}) sort: MatSort;
  @ViewChild(MatPaginator, {static: true}) paginator: MatPaginator;
  @ViewChild(MatCard, {static: true}) table: MatCard;

  data: MatTableDataSource<any> = new MatTableDataSource<StatRowElement>();
  selection = new SelectionModel(true, []);
  expandedElement: StatRowElement | null;
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
              private afa: AngularFireAnalytics,
              changeDetector: ChangeDetectorRef,
              private router: Router, private  datePipe: DatePipe) {
    super(changeDetector);
  }


  ngOnChanges(simpleChanges: SimpleChanges): void {
    this.isLoading ? this.loading() : this.loaded();
    if (!this.events) {
      this.loading();
      return;
    }
    if (this.events && simpleChanges.events && this.data.paginator && this.data.sort) { // If there is no paginator and sort then the compoenent is not initialized on view
      this.processChanges();
    }
    if (this.user && simpleChanges.user) {
      this.paginator._changePageSize(this.user.settings.dashboardSettings.tableSettings.eventsPerPage);
    }
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
    this.data.sortingDataAccessor = (statRowElement: StatRowElement, header) => {
      return statRowElement[`sort.${header}`];
    };
    this.sortSubscription = this.sort.sortChange.subscribe((sort) => {
      if (this.user.settings.dashboardSettings.tableSettings.active !== sort.active || this.user.settings.dashboardSettings.tableSettings.direction !== sort.direction) {
        this.user.settings.dashboardSettings.tableSettings.active = sort.active;
        this.user.settings.dashboardSettings.tableSettings.direction = sort.direction;
        this.userService.updateUserProperties(this.user, {settings: this.user.settings})
      }
    });
    this.processChanges();
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

  private processChanges() {
    this.logger.info(`Processing changes`);
    // this.data = new MatTableDataSource<any>(data);
    this.data.data = this.events.reduce((EventRowElementsArray, event) => {
      if (!event) {
        return EventRowElementsArray;
      }

      const statRowElement = this.getStatsRowElement(event.getStatsAsArray(), (<DataActivityTypes>event.getStat(DataActivityTypes.type))? (<DataActivityTypes>event.getStat(DataActivityTypes.type)).getValue() : [ActivityTypes.unknown], this.user.settings.unitSettings);

      statRowElement['Privacy'] = event.privacy;
      statRowElement['Name'] = event.name;
      statRowElement['Start Date'] = (event.startDate instanceof Date && !isNaN(+event.startDate)) ? this.datePipe.transform(event.startDate, 'EEEEEE d MMM yy HH:mm') : 'None?';
      statRowElement['Activity Types'] = event.getActivityTypesAsString();
      statRowElement['Merged Event'] = event.isMerge;
      statRowElement['Description'] = event.description;
      statRowElement['Device Names'] = event.getDeviceNamesAsString();
      statRowElement['Event'] = event;

      // Add the sorts
      statRowElement['sort.Start Date'] = event.startDate.getTime();
      statRowElement['sort.Activity Types'] = statRowElement['Activity Types'];
      statRowElement['sort.Device Names'] = statRowElement['Device Names'];

      EventRowElementsArray.push(statRowElement);
      return EventRowElementsArray;
    }, []);
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
            promises.push(this.eventService.getEventActivitiesAndStreams(this.user, selected.Event.getID()).pipe(take(1)).toPromise());
          });
          // Now we can clear the selection
          this.selection.clear();
          const events = await Promise.all(promises);
          const mergedEvent = EventUtilities.mergeEvents(events);
          try {
            await this.eventService.setEvent(this.user, mergedEvent);
            await this.afa.logEvent('merge_events');
            await this.router.navigate(['/user', this.user.uid, 'event', mergedEvent.getID()], {});
            this.snackBar.open('Events merged', null, {
              duration: 2000,
            });
          } catch (e) {
            Sentry.withScope(scope => {
              scope.setExtra('data_event', mergedEvent.toJSON());
              mergedEvent.getActivities().forEach((activity, index) => scope.setExtra(`data_activity${index}`, activity.toJSON()));
              Sentry.captureException(e);
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
            this.selection.selected.map(selected => selected.Event).forEach((event) => deletePromises.push(this.eventService.deleteAllEventData(this.user, event.getID())));
            this.selection.clear();
            await Promise.all(deletePromises);
            await this.afa.logEvent('delete_events');
            this.snackBar.open('Events deleted', null, {
              duration: 2000,
            });
            this.loaded();
          });
          return;

        },
        'material',
      ));
    }
  }

  getColumnsToDisplayDependingOnScreenSize() {

    // push all the rest
    let columns = [
      'Expand',
      'Checkbox',
      'Start Date',
      'Activity Types',
      'Duration',
      'Distance',
      'Ascent',
      'Descent',
      'Energy',
      'Average Heart Rate',
      'Average Speed',
      'Average Power',
      'VO2 Max',
      'Device Names',
      'Actions'
    ];

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Highest) {
      return columns;
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.VeryHigh) {
      columns = columns.filter(column => ['Energy'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.High) {
      columns = columns.filter(column => ['Energy', 'Average Power', 'VO2 Max'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Moderate) {
      columns = columns.filter(column => ['Energy', 'Average Power', 'VO2 Max', 'Descent'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Low) {
      columns = columns.filter(column => ['Energy', 'Average Power', 'VO2 Max', 'Descent', 'Device Names'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.VeryLow) {
      columns = columns.filter(column => ['Energy', 'Average Power', 'VO2 Max', 'Descent', 'Device Names', 'Ascent'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Lowest) {
      columns = columns.filter(column => ['Energy', 'Average Power', 'VO2 Max', 'Average Speed', 'Average Heart Rate', 'Descent', 'Device Names', 'Ascent', 'Descent'].indexOf(column) === -1)
    }

    return columns
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
