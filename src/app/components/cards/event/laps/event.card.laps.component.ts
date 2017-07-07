import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';
import {LapInterface} from "../../../../entities/laps/lap.interface";

@Component({
  selector: 'app-event-card-laps',
  templateUrl: './event.card.laps.component.html',
  styleUrls: ['./event.card.laps.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardLapsComponent implements OnChanges {
  @Input() event: EventInterface;
  public lapData: {startDate: Date, endDate: Date, distanceInMeters: number, durationInSeconds: number}[] = [];
  displayedColumns = ['startDate', 'endDate', 'distanceInMeters', 'durationInSeconds'];

  constructor(private changeDetectorRef: ChangeDetectorRef){}

  ngOnChanges() {
  }
}
