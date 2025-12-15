import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';

@Component({
    selector: 'app-activities-toggles',
    templateUrl: './activities-toggles.component.html',
    styleUrls: ['./activities-toggles.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})

export class ActivitiesTogglesComponent {
  @Input() isOwner?: boolean;
  @Input() event: EventInterface;
  @Input() user?: User;

  constructor() {
  }
}
