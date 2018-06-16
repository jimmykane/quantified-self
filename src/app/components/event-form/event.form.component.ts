import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';


@Component({
  selector: 'app-event-form-actions-menu',
  templateUrl: './event.form.component.html',
  // styleUrls: ['./event.actions.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush

})


export class EventFormComponent {
  @Input() event: EventInterface;

  constructor(private eventService: EventService, private changeDetectorRef: ChangeDetectorRef, private router: Router) {
  }

}
