import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';
import {DataHeartRate} from '../../../../entities/data/data.heart-rate';
import {DataCadence} from '../../../../entities/data/data.cadence';
import {DataPower} from '../../../../entities/data/data.power';
import {DataTemperature} from "../../../../entities/data/data.temperature";


@Component({
  selector: 'app-event-card-stats',
  templateUrl: './event.card.stats.component.html',
  styleUrls: ['./event.card.stats.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardStatsComponent implements OnChanges {
  @Input() event: EventInterface;
  public stats = [];

  private dataTypeAverages = [
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

  ngOnChanges() {
    this.stats = [...[
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
        value: (new Date((this.event.getTotalDurationInSeconds() * 1000) / (this.event.getDistanceInMeters() / 1000))).toISOString().substr(14, 5),
        iconName: 'directions_run',
        units: 'm/km',
        iconType: 'material'
      }
    ], ...this.dataTypeAverages];
    this.dataTypeAverages.forEach((dataTypeAverage) => {
      dataTypeAverage.value = this.event.getDataTypeAverage(dataTypeAverage.name).toFixed(0);
    });
  }
}
