import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component, HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import {ActionButtonService} from '../../services/action-buttons/app.action-button.service';
import {ActionButton} from '../../services/action-buttons/app.action-button';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';
import {MatPaginator, MatSnackBar, MatSort, MatSortable, MatTableDataSource} from '@angular/material';
import {SelectionModel} from '@angular/cdk/collections';
import {DatePipe} from '@angular/common';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventUtilities} from 'quantified-self-lib/lib/events/utilities/event.utilities';
import {catchError, first, map, startWith, switchMap, take} from 'rxjs/operators';
import {User} from 'quantified-self-lib/lib/users/user';
import {merge, of, Subscription} from "rxjs";
import * as Raven from "raven-js";
import {Log} from "ng2-logger/browser";


@Component({
  selector: 'app-event-table',
  templateUrl: './event.table.component.html',
  styleUrls: ['./event.table.component.css'],
  providers: [DatePipe],
  // changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventTableComponent implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  @Input() user: User;
  @ViewChild(MatSort) sort: MatSort;
  @ViewChild(MatPaginator) paginator: MatPaginator;
  events: EventInterface[];
  data: MatTableDataSource<any>;
  columns: Array<Object>;
  selection = new SelectionModel(true, []);
  resultsLength = 0;
  isLoadingResults = true;
  isRateLimitReached = false;
  eventsPerPage = 10;
  private eventsSubscription: Subscription;
  private sortSubscription: Subscription;
  private currentPageIndex = 0;

  private logger = Log.create('EventTableComponent');

  public eventSelectionMap: Map<EventInterface, boolean> = new Map<EventInterface, boolean>();

  constructor(private snackBar: MatSnackBar,
              private eventService: EventService,
              private actionButtonService: ActionButtonService,
              private router: Router, private  datePipe: DatePipe) {
  }

  ngOnInit() {
    // If the user changes the sort order, reset back to the first page.
    this.sortSubscription = this.sort.sortChange.subscribe(() => {
      this.paginator.pageIndex = 0;
      this.currentPageIndex = 0;
    });

    this.eventsSubscription = merge(this.sort.sortChange, this.paginator.page)
      .pipe(
        startWith({}),
        switchMap(() => {
          this.isLoadingResults = true;
          if (this.currentPageIndex === this.paginator.pageIndex) {
            return this.eventService.getEventsForUser(this.user, this.sort.active, this.sort.direction === 'asc', this.eventsPerPage);
          }

          // Going to next page
          if (this.currentPageIndex < this.paginator.pageIndex) {
            // Increase the results length
            return this.eventService.getEventsForUser(this.user, this.sort.active, this.sort.direction === 'asc', this.eventsPerPage, this.events[this.events.length - 1]);
          }

          // Going to previous page
          // @todo fix
          if (this.currentPageIndex > this.paginator.pageIndex) {
            return this.eventService.getEventsForUser(this.user, this.sort.active, this.sort.direction === 'asc', this.eventsPerPage, null, this.events[0]);
          }

          // return this.exampleDatabase!.getRepoIssues(
          //   this.sort.active, this.sort.direction, this.paginator.pageIndex);
        }),
        map(events => {
          // debugger;
          // Flip flag to show that loading has finished.
          this.isLoadingResults = false;
          this.isRateLimitReached = false;
          // this.resultsLength = data.total_count;

          // Set the events
          this.events = events;

          const data = events.reduce((eventArray, event) => {
            eventArray.push({
              Checkbox: event,
              Privacy: event.privacy,
              startDate: this.datePipe.transform(event.startDate || null, 'd MMM yy HH:mm'),
              Activities: this.getUniqueStringWithMultiplier(event.getActivities().map((activity) => activity.type)),
              'stats.Distance': event.getDistance().getDisplayValue() + event.getDistance().getDisplayUnit(),
              'stats.Duration': event.getDuration().getDisplayValue(),
              Device:
                this.getUniqueStringWithMultiplier(event.getActivities().map((activity) => activity.creator.name)),
              Actions:
              event,
            });
            return eventArray;
          }, []);

          // Set the columns
          if (data.length) {
            this.columns = Object.keys(data[0]);
          }


          // @todo combine this with after view init
          // if (this.sort) {
          //   this.data.sort = this.sort;
          //   this.data.sort.sort(<MatSortable>{
          //       id: 'Date',
          //       start: 'desc',
          //     },
          //   );
          // }

          return new MatTableDataSource<any>(data);
        }),
        catchError((error) => {
          this.isLoadingResults = false;
          // Catch
          this.isRateLimitReached = true;
          Raven.captureException(error);
          this.logger.error(error);
          return of(new MatTableDataSource([])); // @todo should reject or so
        })
      ).subscribe(data => {

        // Bind to the data
        this.data = data;


        if (this.paginator.pageIndex === 0) {
          this.resultsLength = this.data.data.length === this.eventsPerPage ? this.data.data.length + this.eventsPerPage : this.data.data.length;
          // return;
        }

        // Stayed on the same page
        if (this.currentPageIndex == this.paginator.pageIndex) {
          return;
        }

        // Gone to the next page
        if (this.currentPageIndex < this.paginator.pageIndex) {
          // Increase the results length
          // debugger;
          this.resultsLength = this.data.data.length === this.eventsPerPage ? (this.eventsPerPage * (this.paginator.pageIndex + 2)) : this.eventsPerPage * (this.paginator.pageIndex) + this.data.data.length;
          // return
        }

        // Gone to previous page
        if (this.currentPageIndex > this.paginator.pageIndex) {
          this.resultsLength = this.eventsPerPage * (this.paginator.pageIndex +2)
        }

        // Set the current page index
        this.currentPageIndex = this.paginator.pageIndex;


        // Todo fix this with the rest of the resultsLErgth thing
        // if (!this.resultsLength) {
        //   this.resultsLength = this.data.data.length === this.eventsPerPage ? this.data.data.length + this.eventsPerPage : this.data.data.length;
        //   return;
        // }
        // if (this.data.data.length < this.eventsPerPage) {
        //   this.resultsLength = (this.paginator.pageIndex + 1) * this.eventsPerPage + this.data.data.length
        // }
      });
  }

  ngAfterViewInit() {
  }

  ngOnChanges(): void {
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


  applyFilter(filterValue: string) {
    filterValue = filterValue.trim(); // Remove whitespace
    filterValue = filterValue.toLowerCase(); // MatTableDataSource defaults to lowercase matches
    this.data.filter = filterValue;
  }

  getColumnHeaderIcon(columnName): string {
    switch (columnName) {
      case 'stats.Distance':
        return 'trending_flat';
      case 'stats.Duration':
        return 'timer';
      case 'startDate':
        return 'date_range';
      case 'Location':
        return 'location_on';
      case 'Device':
        return 'watch';
      case 'Name':
        return 'font_download';
      case 'Activities':
        return 'filter_none';
      case 'Privacy':
        return 'visibility';
      default:
        return null;
    }
  }

  isColumnHeaderSortable(columnName): boolean {
    return ['startDate', 'stats.Distance', 'stats.Duration'].indexOf(columnName) !== -1;
  }

  private updateActionButtonService() {
    // Remove all at start and add progressively
    this.actionButtonService.removeActionButton('mergeEvents');
    this.actionButtonService.removeActionButton('deleteEvents');

    if (this.selection.selected.length > 1) {
      this.actionButtonService.addActionButton('mergeEvents', new ActionButton(
        'compare_arrows',
        async () => {
          // First fetch them complete
          const promises: Promise<EventInterface>[] = [];
          this.selection.selected.forEach((selected) => {
            promises.push(this.eventService.getEventActivitiesAndStreams(this.user, selected.Checkbox.getID()).pipe(take(1)).toPromise());
          });
          const events = await Promise.all(promises);
          const mergedEvent = EventUtilities.mergeEvents(events);
          const eventID = await this.eventService.setEventForUser(this.user, mergedEvent);
          // debugger;
          this.actionButtonService.removeActionButton('mergeEvents');
          this.eventSelectionMap.clear();
          this.selection.clear();
          // await this.router.navigate(['/event'], {
          //   queryParams: {
          //     eventID: eventID,
          //     tabIndex: 0,
          //   },
          // });
          this.snackBar.open('Events merged', null, {
            duration: 2000,
          });
        },
        'material',
      ));
    }

    if (this.selection.selected.length > 0) {
      this.actionButtonService.addActionButton('deleteEvents', new ActionButton(
        'delete',
        async () => {
          this.actionButtonService.removeActionButton('deleteEvents');
          this.actionButtonService.removeActionButton('mergeEvents');
          const deletePromises = [];
          this.selection.selected.map(selected => selected.Checkbox).forEach((event) => deletePromises.push(this.eventService.deleteAllEventData(this.user, event.getID())));
          await Promise.all(deletePromises);
          this.eventSelectionMap.clear();
          this.selection.clear();
          this.snackBar.open('Events deleted', null, {
            duration: 2000,
          });
        },
        'material',
      ));
    }
  }

  private getUniqueStringWithMultiplier(arrayOfStrings: string[]) {
    const uniqueObject = arrayOfStrings.reduce((uniqueObj, activityType, index) => {
      if (!uniqueObj[activityType]) {
        uniqueObj[activityType] = 1;
      } else {
        uniqueObj[activityType] += 1;
      }
      return uniqueObj;
    }, {});
    return Object.keys(uniqueObject).reduce((uniqueArray, key, index, object) => {
      if (uniqueObject[key] === 1) {
        uniqueArray.push(key);
      } else {
        uniqueArray.push(uniqueObject[key] + 'x ' + key);
      }
      return uniqueArray;
    }, []).join(', ');
  }

  ngOnDestroy() {
    this.sortSubscription.unsubscribe();
    this.eventsSubscription.unsubscribe();
    this.actionButtonService.removeActionButton('mergeEvents');
    this.actionButtonService.removeActionButton('deleteEvents');
  }
}
