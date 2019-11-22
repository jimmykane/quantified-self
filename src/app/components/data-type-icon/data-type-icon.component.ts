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
  @Input() size: string;
  @Input() vAlign: string;

  getColumnHeaderIcon(statName): string {
    switch (statName) {
      case 'Distance':
        return 'trending_flat';
      case 'Duration':
        return 'access_time';
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
      case 'Power':
      case 'Average Power':
        return 'bolt';
      case 'Average Speed':
      case 'Average speed in kilometers per hour':
      case 'Average speed in miles per hour':
      case 'Average speed in feet per second':
      case 'Average speed in meters per minute':
      case 'Average speed in feet per minute':
      case 'Average Pace':
      case 'Average pace in minutes per mile':
      case 'Average Swim Pace':
      case 'Average swim pace in minutes per 100 yard':
        return 'speed';
      case 'Average Temperature':
        return 'device_thermostat';
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
        return 'heart_pulse';
      case 'Energy':
        return 'energy';
      default:
        return null;
    }
  }
}
