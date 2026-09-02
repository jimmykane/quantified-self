import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import type {
  ActivityCalendarDayViewModel,
  ActivityCalendarViewModel,
} from '../../../helpers/activity-calendar.helper';
import { SharedModule } from '../../../modules/shared.module';
import { AppHapticsService } from '../../../services/app.haptics.service';
import type { PlannedWorkoutCalendarOverlay } from '../../../helpers/planned-workout-calendar.helper';

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
  @Input() plannedWorkoutsByDate: PlannedWorkoutCalendarOverlay = {};
  @Output() daySelected = new EventEmitter<ActivityCalendarDayViewModel>();
  private readonly hapticsService = inject(AppHapticsService);

  selectDay(day: ActivityCalendarDayViewModel): void {
    this.hapticsService.selection();
    this.daySelected.emit(day);
  }
}
