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
        return '#263238';
      }
      case 1: {
        return '#1565c0';
      }
      case 2: {
        return '#558b2f';
      }
      case 3: {
        return '#a51e38';
      }
      case 4: {
        return '#f57f17';
      }
      case 5: {
        return '#2dd86d';
      }
    }
    // Do random else
    return '#' + Math.floor((Math.abs(Math.sin(index) * 16777215)) % 16777215).toString(16);
  }
}
