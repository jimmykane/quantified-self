import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Injectable,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
  inject
} from '@angular/core';
import { AppEventService } from '../../services/app.event.service';
import { Router } from '@angular/router';
import { MatCard } from '@angular/material/card';
import { MatPaginator, MatPaginatorIntl, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';
import { SelectionModel } from '@angular/cdk/collections';
import { DatePipe } from '@angular/common';
import { EventInterface } from '@sports-alliance/sports-lib';
import { EventUtilities } from '@sports-alliance/sports-lib';
import { debounceTime, take } from 'rxjs/operators';
import { User } from '@sports-alliance/sports-lib';
import { Subject, Subscription } from 'rxjs';
import * as Sentry from '@sentry/browser';
import { rowsAnimation } from '../../animations/animations';
import { DataActivityTypes } from '@sports-alliance/sports-lib';
import { DeleteConfirmationComponent } from '../delete-confirmation/delete-confirmation.component';
import { AppUserService } from '../../services/app.user.service';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { DataTableAbstractDirective, StatRowElement } from '../data-table/data-table-abstract.directive';
import { Analytics, logEvent } from '@angular/fire/analytics';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { EventsExportFormComponent } from '../events-export-form/events-export.form.component';
import { MatDialog } from '@angular/material/dialog';
import { OrderByDirection } from 'firebase/firestore';


@Component({
  selector: 'app-event-table',
  templateUrl: './event.table.component.html',
  styleUrls: ['./event.table.component.css'],
  animations: [
    rowsAnimation,
  ],
  providers: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventTableComponent extends DataTableAbstractDirective implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  @Input() user: User;
  @Input() events: EventInterface[];
  @Input() targetUser: User;
  @Input() showActions: boolean;
  @ViewChild(MatSort, { static: true }) sort: MatSort;
  @ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;
  @ViewChild(MatCard, { static: true }) table: MatCard;

  data: MatTableDataSource<any> = new MatTableDataSource<StatRowElement>();
  selection = new SelectionModel(true, []);

  selectedColumns = AppUserService.getDefaultSelectedTableColumns();

  public show = true

  private deleteConfirmationSubscription: Subscription;
  private sortSubscription: Subscription;


  private searchSubject: Subject<string> = new Subject();
  private analytics = inject(Analytics);

  constructor(private snackBar: MatSnackBar,
    private eventService: AppEventService,
    private deleteConfirmationBottomSheet: MatBottomSheet,
    private userService: AppUserService,
    changeDetector: ChangeDetectorRef,
    private eventColorService: AppEventColorService,
    private dialog: MatDialog,
    private router: Router, private datePipe: DatePipe) {
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
      this.selectedColumns = this.user.settings?.dashboardSettings?.tableSettings?.selectedColumns || AppUserService.getDefaultSelectedTableColumns();
      this.paginator?._changePageSize(this.user.settings?.dashboardSettings?.tableSettings?.eventsPerPage || 10);
    }
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error(`Component needs user`)
    }
    this.searchSubject.pipe(
      debounceTime(250)
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
    this.sortSubscription = this.sort.sortChange.subscribe(async (sort) => {
      if (this.user.settings.dashboardSettings.tableSettings.active !== sort.active || this.user.settings.dashboardSettings.tableSettings.direction !== sort.direction) {
        this.user.settings.dashboardSettings.tableSettings.active = sort.active;
        this.user.settings.dashboardSettings.tableSettings.direction = sort.direction as OrderByDirection;
        await this.userService.updateUserProperties(this.user, { settings: this.user.settings })
      }
    });
    if (this.events) {
      this.processChanges();
    }
  }

  checkBoxClick(row) {
    this.selection.toggle(row);
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
  }

  async mergeSelection(event) {
    // Show loading
    this.loading();
    // Remove all subscriptions
    this.unsubscribeFromAll();
    // First fetch them complete
    const promises: Promise<EventInterface>[] = [];
    this.selection.selected.forEach((selected) => {
      promises.push(this.eventService.getEventActivitiesAndAllStreams(this.user, selected.Event.getID()).pipe(take(1)).toPromise());
    });
    // Now we can clear the selection
    this.selection.clear();
    const events = await Promise.all(promises);
    const mergedEvent = EventUtilities.mergeEvents(events);
    try {
      await this.eventService.writeAllEventData(this.user, mergedEvent);
      logEvent(this.analytics, 'merge_events');
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
  }

  async deleteSelection() {
    this.loading();
    const deleteConfirmationBottomSheet = this.deleteConfirmationBottomSheet.open(DeleteConfirmationComponent);
    this.deleteConfirmationSubscription = deleteConfirmationBottomSheet.afterDismissed().subscribe(async (result) => {
      if (!result) {
        this.loaded();
        return;
      }
      this.unsubscribeFromAll();
      const deletePromises = [];
      this.selection.selected.map(selected => selected.Event).forEach((event) => deletePromises.push(this.eventService.deleteAllEventData(this.user, event.getID())));
      this.selection.clear();
      await Promise.all(deletePromises);
      logEvent(this.analytics, 'delete_events');
      this.snackBar.open('Events deleted', null, {
        duration: 2000,
      });
      this.loaded();
    });
  }

  public downloadAsCSV(event) {
    this.dialog.open(EventsExportFormComponent, {
      // width: '100vw',
      disableClose: false,
      data: {
        events: this.selection.selected.map(selected => selected.Event),
        user: this.user,
      },
    });
  }

  // Todo cache this please
  getColumnsToDisplay() {
    // push all the rest
    let columns = [
      'Checkbox',
      'Start Date',
      ...(this.selectedColumns || []).sort(function (a, b) {
        const defaultColumns = AppUserService.getDefaultSelectedTableColumns();
        return defaultColumns.indexOf(a) - defaultColumns.indexOf(b);
      }),
      'Actions'
    ]

    if (!this.showActions) {
      columns = columns.filter(column => column !== 'Checkbox' && column !== 'Actions');
    }

    return columns
  }

  async saveEventDescription(description: string, event: EventInterface) {
    event.description = description;
    await this.eventService.writeAllEventData(this.user, event);
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }

  async saveEventName(name: string, event: EventInterface) {
    event.name = name;
    await this.eventService.writeAllEventData(this.user, event);
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }

  // Noop due to bugs
  async pageChanges(pageEvent: PageEvent) {
    // @important This is nasty because it's called if anything almost changes
    // this.user.settings.dashboardSettings.tableSettings.eventsPerPage = pageEvent.pageSize;
    // return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  search(searchTerm) {
    this.data.filter = searchTerm.trim().toLowerCase();
  }

  onKeyUp(event) {
    this.searchSubject.next(event.target.value);
  }

  async selectedColumnsChange(event: string[]) {
    this.selectedColumns = event
    this.user.settings.dashboardSettings.tableSettings.selectedColumns = this.selectedColumns
    await this.userService.updateUserProperties(this.user, { settings: this.user.settings })
  }

  ngOnDestroy() {
    this.unsubscribeFromAll();
  }

  isSticky(column: string) {
    return column === 'Checkbox'
  }

  isStickyEnd(column: string) {
    return column === 'Actions'
  }

  private processChanges() {
    if (!this.events) {
      return;
    }

    this.selection.clear();
    // this.data = new MatTableDataSource<any>(data);
    this.data.data = this.events.reduce((EventRowElementsArray, event) => {
      if (!event) {
        return EventRowElementsArray;
      }

      const statRowElement = this.getStatsRowElement(event.getStatsAsArray(), (<DataActivityTypes>event.getStat(DataActivityTypes.type)) ? (<DataActivityTypes>event.getStat(DataActivityTypes.type)).getValue() : [ActivityTypes.unknown], this.user.settings.unitSettings);

      statRowElement['Privacy'] = event.privacy;
      statRowElement['Name'] = event.name;
      statRowElement['Start Date'] = (event.startDate instanceof Date && !isNaN(+event.startDate)) ? this.datePipe.transform(event.startDate, 'EEEEEE d MMM yy HH:mm') : 'None?';
      statRowElement['Activity Types'] = event.getActivityTypesAsString();
      statRowElement['Merged Event'] = event.isMerge;
      statRowElement['Description'] = event.description;
      statRowElement['Device Names'] = event.getDeviceNamesAsString();
      statRowElement['Color'] = this.eventColorService.getColorForActivityTypeByActivityTypeGroup(
        event.getActivityTypesAsArray().length > 1 ? ActivityTypes.Multisport : ActivityTypes[event.getActivityTypesAsArray()[0]]
      );
      statRowElement['Event'] = event;

      // Add the sorts
      statRowElement['sort.Start Date'] = event.startDate.getTime();
      statRowElement['sort.Activity Types'] = statRowElement['Activity Types'];
      statRowElement['sort.Description'] = statRowElement['Description'];
      statRowElement['sort.Device Names'] = statRowElement['Device Names'];

      EventRowElementsArray.push(statRowElement);
      return EventRowElementsArray;
    }, []);
    this.loaded();

  }

  private unsubscribeFromAll() {
    if (this.deleteConfirmationSubscription) {
      this.deleteConfirmationSubscription.unsubscribe();
    }
    if (this.sortSubscription) {
      this.sortSubscription.unsubscribe();
    }
  }
}


@Injectable()
export class MatPaginatorIntlFireStore extends MatPaginatorIntl {
  itemsPerPageLabel = 'Items';
  nextPageLabel = 'Next';
  previousPageLabel = 'Previous';
}
