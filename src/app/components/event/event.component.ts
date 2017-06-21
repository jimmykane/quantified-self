import {Component, Input} from '@angular/core';
import {EventInterface} from '../../entities/events/event.interface';

@Component({
  selector: 'app-event',
  templateUrl: './event.component.html',
  styleUrls: ['./event.component.css'],
})
export class EventComponent {
  @Input() event: EventInterface;
}
