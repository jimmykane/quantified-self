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
    switch (lapType) {
      case LapTypes.Distance:
        return 'straighten';
      case LapTypes.Unknown:
        return 'help';
      case LapTypes.AutoLap:
        return 'autorenew'
      case LapTypes.Location:
        return 'pin_drop'
      case LapTypes.Time:
        return 'schedule'
      case LapTypes.Manual:
        return 'touch_app';
      case LapTypes.Interval:
        return 'pace';
      case LapTypes.FitnessEquipment:
        return 'fitness_center';
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
