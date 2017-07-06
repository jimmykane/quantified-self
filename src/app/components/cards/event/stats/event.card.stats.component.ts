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
      units: 'BPM'
    },
    {
      name: DataCadence.name,
      value: null,
      iconName: 'circle-o-notch',
      units: 'SPM'
    },
    {
      name: DataTemperature.name,
      value: null,
      iconName: 'thermometer',
      units: 'Celsius'
    },
    {
      name: DataPower.name,
      value: null,
      iconName: 'flash',
      units: 'WATTS'
    }
  ];

  ngOnChanges() {
    this.stats = [...[
      {
        name: 'Distance',
        value: (this.event.getDistanceInMeters() / 1000).toFixed(2),
        iconName: 'arrows-h',
        units: 'km'
      },
      {
        name: 'Time',
        value: (new Date(this.event.getTotalDurationInSeconds() * 1000)).toISOString().substr(11, 8),
        iconName: 'clock-o',
        units: ''
      }
    ], ...this.dataTypeAverages];
    this.dataTypeAverages.forEach((dataTypeAverage) => {
      dataTypeAverage.value = this.event.getDataTypeAverage(dataTypeAverage.name).toFixed(0);
    });
  }
}
