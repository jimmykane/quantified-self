import {ChangeDetectionStrategy, Component, Input} from '@angular/core';

@Component({
  selector: 'app-card-map-location',
  templateUrl: './event.card.map.location.component.html',
  styleUrls: ['./event.card.map.location.component.css'],

})
export class EventCardMapLocationComponent {
  @Input() locationData: any; //@todo cast from type interface
}

