import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import type {
  ActivityCalendarDayViewModel,
  ActivityCalendarViewModel,
} from '../../../helpers/activity-calendar.helper';
import { SharedModule } from '../../../modules/shared.module';

@Component({
  selector: 'app-activity-calendar-grid',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './activity-calendar-grid.component.html',
  styleUrls: ['./activity-calendar-grid.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityCalendarGridComponent {
  @Input({ required: true }) model: ActivityCalendarViewModel;
  @Input() compact = false;
  @Input() hideOutsideDays = false;
  @Output() daySelected = new EventEmitter<ActivityCalendarDayViewModel>();

  selectDay(day: ActivityCalendarDayViewModel): void {
    if (!day.eventCount) {
      return;
    }
    this.daySelected.emit(day);
  }
}
