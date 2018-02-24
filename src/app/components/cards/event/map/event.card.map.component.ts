import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, Input, OnChanges, OnInit,
  ViewChild
} from '@angular/core';
import {AgmMap, GoogleMapsAPIWrapper, LatLngBoundsLiteral, LatLngLiteral} from '@agm/core';
import {PointInterface} from '../../../../entities/points/point.interface';
import {EventInterface} from '../../../../entities/events/event.interface';
import {Log} from 'ng2-logger';

@Component({
  selector: 'app-event-card-map',
  templateUrl: './event.card.map.component.html',
  styleUrls: ['./event.card.map.component.css'],
  providers: [GoogleMapsAPIWrapper],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardMapComponent implements OnInit {
  @Input() event: EventInterface;
  @Input() resize: boolean;

  public gridListColumnCount = 1;
  public mapRowSpan = 1;

  private logger = Log.create('EventCardMapComponent');

  constructor(private changeDetectorRef: ChangeDetectorRef) {
  }

  ngOnInit() {
    // this.gridListColumnCount = (window.innerWidth) > 640 ? 2 : 1;
    // this.mapRowSpan = (window.innerWidth) > 640 ? 2 : 1;
  }

  @HostListener('window:resize', ['$event.target.innerWidth'])
  onResize(width) {
    // this.gridListColumnCount = width > 640 ? 2 : 1;
    // this.mapRowSpan = width > 640 ? 2 : 1;
  }
}
