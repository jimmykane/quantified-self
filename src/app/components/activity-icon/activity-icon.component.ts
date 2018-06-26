import {Component, Input} from '@angular/core';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import * as Raven from 'raven-js';

@Component({
  selector: 'app-activity-icon',
  templateUrl: './activity-icon.component.html',
  styleUrls: ['./activity-icon.component.css'],
})

export class ActivityIconComponent {
  @Input() activity: ActivityInterface;

  getActivityIcon() {
    if (!this.activity.type) {
      Raven.captureException(new Error('Activity type is not set'));
      return 'beenhere';
    }
    if (this.activity.type.toLocaleLowerCase().includes('run')) {
      return 'directions_run';
    }
    if (this.activity.type.toLocaleLowerCase().includes('hik')) {
      return 'directions_run';
    }
    if (this.activity.type.toLocaleLowerCase().includes('biking')) {
      return 'directions_bike';
    }
    if (this.activity.type.toLocaleLowerCase().includes('cycling')) {
      return 'directions_bike';
    }
    if (this.activity.type.toLocaleLowerCase().includes('swimming')) {
      return 'pool';
    }
    if (this.activity.type.toLocaleLowerCase().includes('rowing')) {
      return 'rowing';
    }
    if (this.activity.type.toLocaleLowerCase().includes('not specified')) {
      return 'help_outline';
    }
    return 'beenhere';
  }
}
