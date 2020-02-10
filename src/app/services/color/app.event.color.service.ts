import {Injectable} from '@angular/core';
import {AppDeviceColors} from './app.device.colors';
import {ActivityInterface} from '@sports-alliance/sports-lib/lib/activities/activity.interface';
import {EventInterface} from '@sports-alliance/sports-lib/lib/events/event.interface';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib/lib/activities/activity.types';
import {AppActivityTypeGroupColors} from './app.activity-type-group.colors';

@Injectable()
export class EventColorService {

  public getColorByNumber(number: number): string {
    // Return fixed random
    return '#' + Math.floor((Math.abs(Math.sin(number) * 16777215)) % 16777215).toString(16);
  }

  public getActivityColor(activities: ActivityInterface[], activity: ActivityInterface): string {
    // Get the index of the requested activity among all activities
    const activityIndex = activities.findIndex((eventActivity) => {
      return activity.getID() === eventActivity.getID();
    });
    if (!AppDeviceColors[activity.creator.name]) {
      return this.getColorByNumber(activityIndex + 5 /* + 10 = pretty */);
    }

    // Find the activities that have the same creator
    const sameCreatorActivities = activities.filter(eventActivity => eventActivity.creator.name === activity.creator.name);
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

  getColorForActivityTypeByActivityTypeGroup(activityType: ActivityTypes): string{
    return AppActivityTypeGroupColors[ActivityTypesHelper.getActivityGroupForActivityType(activityType)];
  }
}
