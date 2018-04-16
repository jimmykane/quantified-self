import {ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, OnInit} from '@angular/core';
import {EventInterface} from '../../entities/events/event.interface';
import {ActionButtonService} from '../../services/action-buttons/app.action-button.service';
import {ActionButton} from '../../services/action-buttons/app.action-button';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';
import {MatSnackBar, MatTableDataSource} from '@angular/material';
import {EventUtilities} from '../../entities/events/utilities/event.utilities';
import {SelectionModel} from '@angular/cdk/collections';
import {DatePipe} from '@angular/common';


@Component({
  selector: 'app-event-card-list',
  templateUrl: './event.table.component.html',
  styleUrls: ['./event.table.component.css'],
  providers: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventTableComponent implements OnChanges, OnInit, OnDestroy {
  @Input() events: EventInterface[];
  data: MatTableDataSource<Object>;
  columns: Array<Object>;
  selection = new SelectionModel(true, []);

  public eventSelectionMap: Map<EventInterface, boolean> = new Map<EventInterface, boolean>();

  constructor(private snackBar: MatSnackBar,
              private eventService: EventService,
              private actionButtonService: ActionButtonService,
              private router: Router, private  datePipe: DatePipe) {
  }

  ngOnInit() {
  }

  ngOnChanges(): void {
    const data = this.events.reduce((eventArray, event) => {
      eventArray.push({
        Event: event,
        Name: event.name.slice(0, 15),
        Distance: event.getDistance().getDisplayValue() + event.getDistance().getDisplayUnit(),
        Duration: event.getDuration().getDisplayValue(),
        Date: this.datePipe.transform(event.getFirstActivity().startDate, 'medium'),
        Location: event.getFirstActivity().geoLocationInfo ? event.getFirstActivity().geoLocationInfo.city + ', ' + event.getFirstActivity().geoLocationInfo.country : '',
        Device: event.getFirstActivity().creator.name,
      });
      return eventArray;
    }, []);
    this.columns = Object.keys(data[0]);
    this.data = new MatTableDataSource(data);
  }

  rowCheckBoxClick(row) {
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

  private updateActionButtonService() {
    if (this.selection.selected.length > 1) {
      this.actionButtonService.addActionButton('mergeEvents', new ActionButton(
        'compare_arrows',
        () => {
          this.actionButtonService.removeActionButton('mergeEvents');
          EventUtilities.mergeEvents(this.selection.selected.map(selected => selected.Event)).then((mergedEvent: EventInterface) => {
            this.actionButtonService.removeActionButton('mergeEvents');
            this.eventService.addAndSaveEvent(mergedEvent);
            this.eventSelectionMap.clear();
            this.router.navigate(['/dashboard'], {
              queryParams: {
                eventID: mergedEvent.getID(),
                tabIndex: 0
              }
            }).then(() => {
              this.snackBar.open('Events merged', null, {
                duration: 5000,
              });
            });
          })
        },
        'material'
      ))
    } else {
      this.actionButtonService.removeActionButton('mergeEvents');
    }
  }

  ngOnDestroy() {
    this.actionButtonService.removeActionButton('mergeEvents');
  }
}
