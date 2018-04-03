import {ChangeDetectionStrategy, Component, Input, OnChanges, OnInit} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';
import {DataHeartRate} from '../../../../entities/data/data.heart-rate';
import {DataCadence} from '../../../../entities/data/data.cadence';
import {DataPower} from '../../../../entities/data/data.power';
import {DataTemperature} from '../../../../entities/data/data.temperature';
import {ActivityInterface} from '../../../../entities/activities/activity.interface';


@Component({
  selector: 'app-event-card-activity-stats',
  templateUrl: './event.card.activity.stats.component.html',
  styleUrls: ['./event.card.activity.stats.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardActivityStatsComponent implements OnChanges, OnInit {
  @Input() activity: ActivityInterface;
  @Input() event: EventInterface;
  public stats = [];

  ngOnInit() {
  }

  ngOnChanges() {
    this.stats.push(
      {
        name: 'Distance',
        value: (this.activity.summary.totalDistanceInMeters / 1000).toFixed(2),
        iconName: 'arrows-h',
        units: 'km',
        iconType: 'fontAwesome'
      },
      {
        name: 'Time',
        value: (new Date(this.activity.summary.totalDurationInSeconds * 1000)).toISOString().substr(11, 8),
        iconName: 'clock-o',
        units: '',
        iconType: 'fontAwesome'
      },
    );
    if (this.activity.summary.totalDistanceInMeters) {
      this.stats.push({
        name: 'Pace',
        value: (new Date(((this.activity.summary.totalDurationInSeconds - (this.activity.summary.pauseDurationInSeconds || 0)) * 1000) / (this.activity.summary.totalDistanceInMeters / 1000))).toISOString().substr(14, 5),
        iconName: 'directions_run',
        units: 'm/km',
        iconType: 'material'
      });
    }
    if (this.activity.summary.avgSpeed) {
      this.stats.push({
        name: 'Speed',
        value: ((this.activity.summary.totalDistanceInMeters / 1000) / ((this.activity.summary.totalDurationInSeconds - this.activity.summary.pauseDurationInSeconds) / 60 / 60)).toFixed(1),
        iconName: 'directions_bike',
        units: 'km/h',
        iconType: 'material'
      });
    }

    if (this.activity.summary.avgHR) {
      this.stats.push({
        name: DataHeartRate.type,
        value: Math.round(this.activity.summary.avgHR),
        iconName: 'heartbeat',
        units: DataHeartRate.unit,
        iconType: 'fontAwesome'
      });
    }

    if (this.activity.summary.avgCadence) {
      this.stats.push({
        name: DataCadence.type,
        value: Math.round(this.activity.summary.avgCadence),
        iconName: 'loop',
        units: DataCadence.unit,
        iconType: 'material'
      });
    }

    if (this.activity.summary.avgPower) {
      this.stats.push({
        name: DataPower.type,
        value: Math.round(this.activity.summary.avgCadence),
        iconName: 'flash',
        units: DataPower.unit,
        iconType: 'fontAwesome'
      });
    }

    if (this.activity.summary.avgTemperature) {
      this.stats.push({
        name: DataTemperature.type,
        value: Math.round(this.activity.summary.avgCadence),
        iconName: 'thermometer',
        units: DataTemperature.unit,
        iconType: 'fontAwesome'
      });
    }

    if (this.activity.summary.ascentInMeters) {
      this.stats.push({
        name: 'Ascent',
        value: Math.round(this.activity.summary.ascentInMeters),
        iconName: 'trending_up',
        units: 'm',
        iconType: 'material'
      });
    }

    if (this.activity.summary.ascentTimeInSeconds) {
      this.stats.push({
        name: 'Ascent Time',
        value: new Date(this.activity.summary.ascentTimeInSeconds * 1000).toISOString().substr(11, 8),
        iconName: null,
        units: null,
        iconType: null
      });
    }

    if (this.activity.summary.descentInMeters) {
      this.stats.push({
        name: 'Descent',
        value: Math.round(this.activity.summary.descentInMeters),
        iconName: 'trending_down',
        units: 'm',
        iconType: 'material'
      });
    }

    if (this.activity.summary.descentTimeInSeconds) {
      this.stats.push({
        name: 'Descent Time',
        value: new Date(this.activity.summary.descentTimeInSeconds * 1000).toISOString().substr(11, 8),
        iconName: null,
        units: null,
        iconType: null
      });
    }

    if (this.activity.summary.recoveryTimeInSeconds) {
      this.stats.push({
        name: 'Recovery Time',
        value: Math.floor(this.activity.summary.recoveryTimeInSeconds / 60 / 60),
        iconName: 'restore',
        units: 'hours',
        iconType: 'material'
      });
    }

    if (this.activity.summary.energyInCal) {
      this.stats.push({
        name: 'KCal',
        value: Math.round(this.activity.summary.energyInCal),
        iconName: null,
        units: null,
        iconType: null
      });
    }

    if (this.activity.summary.peakTrainingEffect) {
      this.stats.push({
        name: 'PTE',
        value: this.activity.summary.peakTrainingEffect.toFixed(1),
        iconName: null,
        units: null,
        iconType: null
      });
    }

    if (this.activity.summary.peakTrainingEffect) {
      this.stats.push({
        name: 'EPOC',
        value: this.activity.summary.epoc,
        iconName: null,
        units: null,
        iconType: null
      });
    }
  }
}
