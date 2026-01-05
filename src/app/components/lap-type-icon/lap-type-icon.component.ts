import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {DataDistance} from '@sports-alliance/sports-lib';
import { DataAscent } from '@sports-alliance/sports-lib';
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

  getColumnHeaderIcon(lapType): string {
    switch (lapType) {
      case LapTypes.Distance:
        return 'trending_flat';
      case LapTypes.Unknown:
        return 'emoji_flags';
      case LapTypes.AutoLap:
        return 'autorenew'
      case LapTypes.Location:
        return 'location_on'
      case LapTypes.Time:
        return 'timer'
      default:
        return null;
    }
  }

  getColumnHeaderSVGIcon(lapType): string {
    switch (lapType) {
      case LapTypes.Manual:
        return 'lap-type-manual';
      case LapTypes.Interval:
      case LapTypes.FitnessEquipment: // Intentional, fitness equipement is selected for intervals on  fit files
        return 'lap-type-interval';
      default:
        return null;
    }
  }

  getColumnHeaderTextInitials(statName): string {
    return statName.split(' ').map(i => i.charAt(0).toUpperCase()).join('')
  }
}
