import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';
import {DataHeartRate} from '../../../../entities/data/data.heart-rate';
import {DataCadence} from '../../../../entities/data/data.cadence';
import {DataPower} from '../../../../entities/data/data.power';
import {DataTemperature} from '../../../../entities/data/data.temperature';
import {DataAltitude} from '../../../../entities/data/data.altitude';


@Component({
  selector: 'app-event-card-stats',
  templateUrl: './event.card.stats.component.html',
  styleUrls: ['./event.card.stats.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardStatsComponent implements OnChanges {
  @Input() event: EventInterface;
  public stats = [];

  public dataTypeAverages = [
    {
      name: DataHeartRate.name,
      value: null,
      iconName: 'heartbeat',
      units: 'BPM',
      iconType: 'fontAwesome'
    },
    {
      name: DataCadence.name,
      value: null,
      iconName: 'circle-o-notch',
      units: 'SPM',
      iconType: 'fontAwesome'
    },
    {
      name: DataTemperature.name,
      value: null,
      iconName: 'thermometer',
      units: 'Celsius',
      iconType: 'fontAwesome'
    },
    {
      name: DataPower.name,
      value: null,
      iconName: 'flash',
      units: 'WATTS',
      iconType: 'fontAwesome'
    }
  ];

  public dataTypeGains = [
    {
      name: DataAltitude.name,
      value: null,
      iconName: 'trending_up',
      units: 'm',
      iconType: 'material'
    }
  ];

  public dataTypeLosses = [
    {
      name: DataAltitude.name,
      value: null,
      iconName: 'trending_down',
      units: 'm',
      iconType: 'material'
    }
  ];

  ngOnChanges() {
    this.dataTypeAverages.forEach((dataTypeAverage) => {
      dataTypeAverage.value = Number(this.event.getDataTypeAverage(dataTypeAverage.name).toFixed(0));
    });
    this.dataTypeGains.forEach((dataTypeGain) => {
      dataTypeGain.value = Number(this.event.getDataTypeGain(dataTypeGain.name).toFixed(0));
    });
    this.dataTypeLosses.forEach((dataTypeLoss) => {
      dataTypeLoss.value = Number(this.event.getDataTypeLoss(dataTypeLoss.name).toFixed(0));
    });

    this.stats = this.dataTypeGains.concat(
      this.dataTypeLosses,
      [
        {
          name: 'Distance',
          value: (this.event.getDistanceInMeters() / 1000).toFixed(2),
          iconName: 'arrows-h',
          units: 'km',
          iconType: 'fontAwesome'
        },
        {
          name: 'Time',
          value: (new Date(this.event.getTotalDurationInSeconds() * 1000)).toISOString().substr(11, 8),
          iconName: 'clock-o',
          units: '',
          iconType: 'fontAwesome'
        },
        {
          name: 'Pace',
          value: (new Date((this.event.getTotalDurationInSeconds() * 1000) / (this.event.getDistanceInMeters() / 1000)))
            .toISOString().substr(14, 5),
          iconName: 'directions_run',
          units: 'm/km',
          iconType: 'material'
        },
        {
          name: 'Speed',
          value: ((this.event.getDistanceInMeters() / 1000) / (this.event.getTotalDurationInSeconds() / 60 / 60)).toFixed(1),
          iconName: 'directions_bike',
          units: 'km/h',
          iconType: 'material'
        }
      ],
      this.dataTypeAverages
    );
  }
}
