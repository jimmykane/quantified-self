import {Injectable} from '@angular/core';
import {EventInterface} from '../entities/events/event.interface';
import {ActivityInterface} from '../entities/activities/activity.interface';


@Injectable()
export class AppEventColorService {
  public getActivityColor(event: EventInterface, activity: ActivityInterface): string {
    const index = event.getActivities().findIndex((eventActivity) => {
      return activity === eventActivity
    });
    switch (index) {
      case 0: {
        return '#000000';
      }
      case 1: {
        return '#1881ea';
      }
      case 2: {
        return '#71be76';
      }
      case 3: {
        return '#a51e38';
      }
      case 4: {
        return '#d38e2e';
      }
      case 5: {
        return '#2dd86d';
      }
    }
    return '#' + Math.floor((Math.abs(Math.sin(index) * 16777215)) % 16777215).toString(16);
  }
}
