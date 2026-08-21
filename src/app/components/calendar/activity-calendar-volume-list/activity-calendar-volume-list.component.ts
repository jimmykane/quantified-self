import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { ActivityCalendarFamilyVolumeRow } from '../../../helpers/activity-calendar-volume.helper';
import { SharedModule } from '../../../modules/shared.module';
import { ActivityCalendarVolumeStatsComponent } from './activity-calendar-volume-stats.component';

@Component({
  selector: 'app-activity-calendar-volume-list',
  standalone: true,
  imports: [SharedModule, ActivityCalendarVolumeStatsComponent],
  templateUrl: './activity-calendar-volume-list.component.html',
  styleUrls: ['./activity-calendar-volume-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityCalendarVolumeListComponent {
  readonly rows = input<readonly ActivityCalendarFamilyVolumeRow[]>([]);
  readonly emphasizeNumericText = input(false);
  readonly rowSelected = output<ActivityCalendarFamilyVolumeRow>();

  selectRow(row: ActivityCalendarFamilyVolumeRow): void {
    if (!row.route) {
      return;
    }
    this.rowSelected.emit(row);
  }
}
