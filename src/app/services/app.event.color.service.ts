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
        return '#FFA500';
      }
      case 1: {
        return '#00008B';
      }
      case 2: {
        return '#FF00FF';
      }
      case 3: {
        return '#00FF00';
      }
      case 4: {
        return '#800080';
      }
      case 5: {
        return '#a4a8f5';
      }
    }
    // Do random else
    return '#' + Math.floor((Math.abs(Math.sin(index) * 16777215)) % 16777215).toString(16);
  }
}
