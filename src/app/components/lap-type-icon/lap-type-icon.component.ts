import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { LapTypes } from '@sports-alliance/sports-lib';


@Component({
  selector: 'app-lap-type-icon',
  templateUrl: './lap-type-icon.component.html',
  styleUrls: ['./lap-type-icon.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class LapTypeIconComponent {
  @Input() lapType: LapTypes;
  @Input() size: string;
  @Input() vAlign: string;

  getColumnHeaderIcon(lapType: LapTypes): string {
    switch (String(lapType).trim().toLowerCase()) {
      case 'distance':
        return 'straighten';
      case 'unknown':
        return 'help';
      case 'autolap':
      case 'auto lap':
        return 'autorenew'
      case 'location':
        return 'pin_drop'
      case 'time':
        return 'schedule'
      case 'manual':
        return 'touch_app';
      case 'interval':
        return 'pace';
      case 'low interval':
        return 'keyboard_double_arrow_down';
      case 'high interval':
        return 'keyboard_double_arrow_up';
      case 'fitness equipment':
        return 'fitness_center';
      case 'start':
      case 'position start':
        return 'play_arrow';
      case 'stop':
      case 'session end':
        return 'stop_circle';
      case 'heart rate':
        return 'favorite';
      case 'position lap':
        return 'location_on';
      case 'position waypoint':
        return 'route';
      case 'position marked':
        return 'bookmark';
      default:
        return null;
    }
  }

  getColumnHeaderSVGIcon(lapType): string {
    return null;
  }

  getColumnHeaderTextInitials(statName): string {
    return statName.split(' ').map(i => i.charAt(0).toUpperCase()).join('')
  }
}
