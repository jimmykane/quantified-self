import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';

@Component({
  selector: 'app-event-card-stats',
  templateUrl: './event.card.stats.component.html',
  styleUrls: ['./event.card.stats.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardStatsComponent {
  @Input() event: EventInterface;

}
