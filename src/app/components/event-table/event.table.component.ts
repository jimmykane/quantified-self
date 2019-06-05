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
import { MatCard } from '@angular/material/card';
import { MatPaginator, MatPaginatorIntl } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSort, MatSortable } from '@angular/material/sort';
import { MatTable, MatTableDataSource } from '@angular/material/table';
import {SelectionModel} from '@angular/cdk/collections';
import {DatePipe} from '@angular/common';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventUtilities} from 'quantified-self-lib/lib/events/utilities/event.utilities';
import {catchError, first, map, startWith, switchMap, take} from 'rxjs/operators';
import {User} from 'quantified-self-lib/lib/users/user';
import {merge, of, Subscription} from 'rxjs';
import * as Raven from 'raven-js';
import {Log} from 'ng2-logger/browser';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {DataAscent} from 'quantified-self-lib/lib/data/data.ascent';
import {DataDescent} from 'quantified-self-lib/lib/data/data.descent';
import WhereFilterOp = firebase.firestore.WhereFilterOp;
import {DataEnergy} from "quantified-self-lib/lib/data/data.energy";
import {DataHeartRateAvg} from "quantified-self-lib/lib/data/data.heart-rate-avg"; // @todo investigate if this import is ok



@Component({
  selector: 'app-event-table',
  templateUrl: './event.table.component.html',
  styleUrls: ['./event.table.component.css'],
  providers: [DatePipe],
  // changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventTableComponent implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  @Input() user: User;
  @Input() privacyFilter?: Privacy;
  @Input() eventsPerPage ? = 10;
  @Input() hasActions?: boolean;
  @ViewChild(MatSort, { static: true }) sort: MatSort;
  @ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;
  @ViewChild(MatCard, { static: true }) table: MatCard;
  events: EventInterface[];
  data: MatTableDataSource<any>;
  selection = new SelectionModel(true, []);
  resultsLength = 0;
  isLoadingResults = true;
  errorLoading;
  searchTerm: string;
  searchStartDate: Date;
  searchEndDate: Date;
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
    this.subscribeToAll();
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


  search(search: {searchTerm: string, startDate: Date, endDate: Date}) {
    this.searchTerm = search.searchTerm;
    this.searchStartDate = search.startDate;
    this.searchEndDate = search.endDate;
    this.subscribeToAll();
  }

  getColumnHeaderIcon(columnName): string {
    switch (columnName) {
      case 'stats.Distance':
        return 'trending_flat';
      case 'stats.Ascent':
        return 'trending_up';
      case 'stats.Descent':
        return 'trending_down';
      case 'stats.Duration':
        return 'timer';
      case 'startDate':
        return 'date_range';
      case 'device':
        return 'watch';
      case 'name':
        return 'font_download';
      case 'activities':
        return 'filter_none';
      case 'privacy':
        return 'visibility';
      default:
        return null;
    }
  }

  isColumnHeaderSortable(columnName): boolean {
    return ['startDate', 'name', 'stats.Distance', 'stats.Duration', 'stats.Ascent', 'stats.Descent'].indexOf(columnName) !== -1;
  }


  private subscribeToAll() {
    this.unsubscribeFromAll();
    this.paginator.pageIndex = 0;
    this.currentPageIndex = 0;
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
          const where = [];
          if (this.searchTerm) {
            where.push({
              fieldPath: 'name',
              opStr: <WhereFilterOp>'==',
              value: this.searchTerm
            })
          }
          if (this.searchStartDate) {
            this.searchStartDate.setHours(0, 0, 0, 0) ;
            where.push({
              fieldPath: 'startDate',
              opStr: <WhereFilterOp>'>=',
              value: this.searchStartDate.getTime() // Should remove mins from date
            })
          }
          if (this.searchEndDate) {
            this.searchEndDate.setHours(24, 0, 0, 0) ;
            where.push({
              fieldPath: 'startDate',
              opStr: <WhereFilterOp>'<=', // Should remove mins from date
              value: this.searchEndDate.getTime()
            })
          }
          if (this.privacyFilter) {
            where.push({
              fieldPath: 'privacy',
              opStr: <WhereFilterOp>'==',
              value: this.privacyFilter
            })
          }
          if (this.currentPageIndex === this.paginator.pageIndex) {
            return this.eventService.getEventsForUser(this.user, where, this.sort.active, this.sort.direction === 'asc', this.eventsPerPage);
          }

          // Going to next page
          if (this.currentPageIndex < this.paginator.pageIndex) {
            // Increase the results length
            return this.eventService.getEventsForUser(this.user, where, this.sort.active, this.sort.direction === 'asc', this.eventsPerPage, this.events[this.events.length - 1]);
          }

          // Going to previous page
          if (this.currentPageIndex > this.paginator.pageIndex) {
            return this.eventService.getEventsForUser(this.user, where, this.sort.active, this.sort.direction !== 'asc', this.eventsPerPage, this.events[0]);
          }

          // return this.exampleDatabase!.getRepoIssues(
          //   this.sort.active, this.sort.direction, this.paginator.pageIndex);
        }),
        map(events => {
          // debugger;
          // Flip flag to show that loading has finished.
          this.isLoadingResults = false;
          this.errorLoading = false;
          // this.resultsLength = data.total_count;

          // Set the events
          this.events = events;

          // Reverse sort if we are going to prev page see https://stackoverflow.com/questions/54074135/firestore-angularfire-how-to-paginate-to-previous-page/54075453#54075453
          if (this.currentPageIndex > this.paginator.pageIndex) {
            this.events.reverse();
          }

          const data = events.reduce((eventArray, event) => {
            if (!event) {
              return eventArray;
            }
            const dataObject: any = {};
            if (this.hasActions) {
              dataObject.checkbox = event;
            }


            const ascent = event.getStat(DataAscent.type);
            const descent = event.getStat(DataDescent.type);
            const energy = event.getStat(DataEnergy.type);
            const heartRateAverage = event.getStat(DataHeartRateAvg.type);
            dataObject.id = event.getID();
            dataObject.privacy = event.privacy;
            dataObject.name = event.name;
            dataObject.startDate = (event.startDate instanceof Date && !isNaN(+event.startDate)) ? this.datePipe.transform(event.startDate, 'd MMM yy HH:mm') : 'None?';
            dataObject.activities = this.getUniqueStringWithMultiplier(event.getActivities().map((activity) => activity.type));
            dataObject['stats.Distance'] = `${event.getDistance().getDisplayValue()} ${event.getDistance().getDisplayUnit()}`;
            dataObject['stats.Ascent'] = ascent ? `${ascent.getDisplayValue()} ${ascent.getDisplayUnit()}` : '';
            dataObject['stats.Descent'] = descent ? `${descent.getDisplayValue()} ${descent.getDisplayUnit()}` : '';
            dataObject['stats.Energy'] = energy ? `${energy.getDisplayValue()} ${energy.getDisplayUnit()}` : '';
            dataObject['stats.HeartRateAverage'] = heartRateAverage ? `${heartRateAverage.getDisplayValue()} ${heartRateAverage.getDisplayUnit()}` : '';
            dataObject['stats.Duration'] = event.getDuration().getDisplayValue();
            dataObject.device = this.getUniqueStringWithMultiplier(event.getActivities().map((activity) => activity.creator.name));
            // dataObject.event = event;
            if (this.hasActions) {
              dataObject.actions = event;
            }

            eventArray.push(dataObject);
            return eventArray;
          }, []);

          // Set the columns
          // if (data.length) {
          //   this.columns = Object.keys(data[0]).filter((key) => !(key === 'id' || key === 'event'));
          // }

          return new MatTableDataSource<any>(data);
        }),
        catchError((error) => {
          this.isLoadingResults = false;
          // Catch
          this.errorLoading = error; // @todo maybe reset on ok
          Raven.captureException(error);
          this.logger.error(error);
          return of(new MatTableDataSource([])); // @todo should reject or so
        })
      ).subscribe(data => {
        // Bind to the data
        this.data = data;

        // debugger;


        if (this.paginator.pageIndex === 0) {
          this.resultsLength = this.data.data.length === this.eventsPerPage ? this.data.data.length + this.eventsPerPage : this.data.data.length;
          // return;
        }

        // Stayed on the same page but data came in
        if (this.currentPageIndex === this.paginator.pageIndex) {
          // If we have no data (eg this pages event's were deleted) go to prev page
          if (!this.data.data.length && this.paginator.pageIndex !== 0) {
            this.goToPageNumber(this.currentPageIndex - 1);
            return;
          }
          // debugger;
          this.resultsLength = this.data.data.length === this.eventsPerPage ? (this.eventsPerPage * (this.paginator.pageIndex + 2)) : this.eventsPerPage * (this.paginator.pageIndex) + this.data.data.length;
        }

        // Gone to the next page
        if (this.currentPageIndex < this.paginator.pageIndex) {
          // If we just went to next page with empty data go to prev
          if (!data.data.length) {
            this.goToPageNumber(this.currentPageIndex);
            this.snackBar.open('No more events to show', null, {
              duration: 2000,
            });
            return;
          }
          // Increase the results length
          this.resultsLength = this.data.data.length === this.eventsPerPage ? (this.eventsPerPage * (this.paginator.pageIndex + 2)) : this.eventsPerPage * (this.paginator.pageIndex) + this.data.data.length;
          // return
        }

        // Gone to previous page
        if (this.currentPageIndex > this.paginator.pageIndex) {
          this.resultsLength = this.eventsPerPage * (this.paginator.pageIndex + 2)
        }

        // Set the current page index
        this.currentPageIndex = this.paginator.pageIndex;
      });
  }

  private updateActionButtonService() {
    // Remove all at start and add progressively
    this.actionButtonService.removeActionButton('mergeEvents');
    this.actionButtonService.removeActionButton('deleteEvents');

    if (this.selection.selected.length > 1) {
      this.actionButtonService.addActionButton('mergeEvents', new ActionButton(
        'compare_arrows',
        async () => {
          this.isLoadingResults = true;
          // Clear all selections
          this.actionButtonService.removeActionButton('mergeEvents');
          this.actionButtonService.removeActionButton('deleteEvents');
          // First fetch them complete
          const promises: Promise<EventInterface>[] = [];
          this.selection.selected.forEach((selected) => {
            promises.push(this.eventService.getEventActivitiesAndStreams(this.user, selected.checkbox.getID()).pipe(take(1)).toPromise());
          });
          // Now we can clear the selection
          this.eventSelectionMap.clear();
          this.selection.clear();
          const events = await Promise.all(promises);
          const mergedEvent = EventUtilities.mergeEvents(events);
          await this.eventService.setEvent(this.user, mergedEvent);
          // debugger;
          this.isLoadingResults = false;

          await this.router.navigate(['/user', this.user.uid, 'event', mergedEvent.getID()], {});
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
          this.isLoadingResults = true;
          this.actionButtonService.removeActionButton('deleteEvents');
          this.actionButtonService.removeActionButton('mergeEvents');
          this.unsubscribeFromAll();
          const deletePromises = [];
          this.selection.selected.map(selected => selected.checkbox).forEach((event) => deletePromises.push(this.eventService.deleteAllEventData(this.user, event.getID())));
          this.eventSelectionMap.clear();
          this.selection.clear();
          await Promise.all(deletePromises);
          this.isLoadingResults = false;
          this.subscribeToAll();
          this.snackBar.open('Events deleted', null, {
            duration: 2000,
          });
        },
        'material',
      ));
    }
  }

  private goToPageNumber(number: number) {
    this.paginator.pageIndex = number;
    this.currentPageIndex = number;
    this.paginator.page.next({
      pageIndex: number,
      pageSize: this.paginator.pageSize,
      length: this.paginator.length
    });
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

  @HostListener('window:resize', ['$event'])
  getColumnsToDisplayDependingOnScreenSize(event?) {
    let columns = [];
    // Push the starting one
    if (this.hasActions) {
      columns.push('checkbox')
    }

    // push all the rest
    columns.push(...[
      'privacy',
      'name',
      'startDate',
      'activities',
      'stats.Distance',
      'stats.Ascent',
      'stats.Descent',
      'stats.Energy',
      'stats.HeartRateAverage',
      'stats.Duration',
      'device',
    ]);

    if (window.innerWidth < 1000) {
      columns = columns.filter(column => [ 'stats.Energy' ].indexOf(column) === -1)
    }

    if (window.innerWidth < 920) {
      columns = columns.filter(column => [ 'stats.HeartRateAverage' ].indexOf(column) === -1)
    }

    if (window.innerWidth < 860) {
      columns = columns.filter(column => [ 'stats.Descent' ].indexOf(column) === -1)
    }

    if (window.innerWidth < 760) {
      columns = columns.filter(column => ['name'].indexOf(column) === -1)
    }

    if (window.innerWidth < 660) {
      columns = columns.filter(column => ['activities', 'stats.Ascent'].indexOf(column) === -1)
    }

    if (window.innerWidth < 560) {
      columns = columns.filter(column => ['privacy'].indexOf(column) === -1)
    }

    // Push the last
    if (this.hasActions) {
      columns.push('actions')
    }
    return columns
  }

  private unsubscribeFromAll() {
    if (this.sortSubscription) {
      this.sortSubscription.unsubscribe();
    }
    if (this.eventsSubscription) {
      this.eventsSubscription.unsubscribe();
    }
  }

  ngOnDestroy() {
    this.unsubscribeFromAll();
    this.actionButtonService.removeActionButton('mergeEvents');
    this.actionButtonService.removeActionButton('deleteEvents');
  }
}


export class MatPaginatorIntlFireStore extends MatPaginatorIntl {
  itemsPerPageLabel = 'Items par page';
  nextPageLabel = 'Load more...';
  previousPageLabel = 'go to previous set';

  getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === (page + 2) * pageSize) {
      return `${page * pageSize} - ${(page + 1) * pageSize}`
    }

    return `${page * pageSize} - ${length} `
  }
}
