import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';

@Component({
  selector: 'app-calendar-activity-tags',
  standalone: true,
  imports: [MatChipsModule],
  templateUrl: './calendar-activity-tags.component.html',
  styleUrls: ['./calendar-activity-tags.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarActivityTagsComponent {
  readonly tags = input.required<readonly string[]>();
}
