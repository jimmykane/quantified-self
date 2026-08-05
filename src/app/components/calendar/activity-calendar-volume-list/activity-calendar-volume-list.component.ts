import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ActivityCalendarFamilyVolumeRow } from '../../../helpers/activity-calendar-volume.helper';
import { SharedModule } from '../../../modules/shared.module';

@Component({
  selector: 'app-activity-calendar-volume-list',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './activity-calendar-volume-list.component.html',
  styleUrls: ['./activity-calendar-volume-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityCalendarVolumeListComponent {
  readonly rows = input<readonly ActivityCalendarFamilyVolumeRow[]>([]);
}
