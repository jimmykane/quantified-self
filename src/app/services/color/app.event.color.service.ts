import {Injectable} from '@angular/core';
import {EventInterface} from '../../entities/events/event.interface';
import {ActivityInterface} from '../../entities/activities/activity.interface';
import {CreatorInterface} from '../../entities/creators/creatorInterface';
import {AppColors} from './app.colors';
import {AppDeviceColors} from './app.device.colors';


@Injectable()
export class AppEventColorService {

  public getColorByNumber(number: number): string {
    // Return fixed random
    return '#' + Math.floor((Math.abs(Math.sin(number) * 16777215)) % 16777215).toString(16);
  }

  public getActivityColor(event: EventInterface, activity: ActivityInterface): string {
    // Get the index of the requested activity among all activities
    const activityIndex = event.getActivities().findIndex((eventActivity) => {
      return activity === eventActivity
    });
    if (!AppDeviceColors[activity.creator.name]) {
      return this.getColorByNumber(activityIndex + 10 /* + 10 = pretty */);
    }

    // Find the activities that have the same creator
    const sameCreatorActivities = event.getActivities().filter(eventActivity => eventActivity.creator.name === activity.creator.name);
    // If there are no activities with the same creator return the color of this creator
    if (!sameCreatorActivities.length) {
      return AppDeviceColors[activity.creator.name];
    }
    // Get the index on the same creator activities
    const sameCreatorActivitiesActivityIndex = sameCreatorActivities.findIndex((eventActivity) => {
      return activity === eventActivity
    });

    // If its the first one return the color
    if (sameCreatorActivitiesActivityIndex === 0) {
      return AppDeviceColors[activity.creator.name];
    }
    // Else it's not the first one, then return the global activity index color
    return this.getColorByNumber(activityIndex);
  }
}
