import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ActivityCalendarFamilyVolumeStat } from '../../../helpers/activity-calendar-volume.helper';
import { SharedModule } from '../../../modules/shared.module';

@Component({
  selector: 'app-activity-calendar-volume-stats',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './activity-calendar-volume-stats.component.html',
  styleUrls: ['./activity-calendar-volume-stats.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityCalendarVolumeStatsComponent {
  readonly stats = input<readonly ActivityCalendarFamilyVolumeStat[]>([]);
}
