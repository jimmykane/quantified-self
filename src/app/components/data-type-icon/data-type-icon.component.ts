import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';

@Component({
  selector: 'app-data-type-icon',
  templateUrl: './data-type-icon.component.html',
  styleUrls: ['./data-type-icon.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class DataTypeIconComponent {
  @Input() dataType: string;

  getColumnHeaderIcon(statName): string {
    switch (statName) {
      case 'Distance':
        return 'trending_flat';
      case 'Duration':
        return 'timer';
      case 'startDate':
        return 'date_range';
      case 'Device Names':
        return 'watch';
      case 'name':
        return 'font_download';
      case 'Activity Types':
        return 'filter_none';
      case 'privacy':
        return 'visibility';
      default:
        return null;
    }
  }

  getColumnHeaderSVGIcon(statName): string {
    switch (statName) {
      case 'Ascent':
        return 'arrow_up_right';
      case 'Descent':
        return 'arrow_down_right';
      case 'Average Heart Rate':
        return 'heart_rate';
      case 'Energy':
        return 'energy';
      default:
        return null;
    }
  }
}
