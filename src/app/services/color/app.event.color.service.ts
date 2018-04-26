import {Injectable} from '@angular/core';
import {EventInterface} from '../../entities/events/event.interface';
import {ActivityInterface} from '../../entities/activities/activity.interface';
import {CreatorInterface} from '../../entities/creators/creatorInterface';
import {AppColors} from './app.colors';
import {AppDeviceColors} from './app.device.colors';


@Injectable()
export class AppEventColorService {

  private static getColorByCreator(activity: ActivityInterface, creator: CreatorInterface): string {
    return AppDeviceColors[creator.name];
  }

  private static getColorByIndex(index: number): string {
    switch (index) {
      case 0: {
        return AppColors.Orange;
      }
      case 1: {
        return AppColors.Blue;
      }
      case 2: {
        return AppColors.Pink;
      }
      case 3: {
        return AppColors.Green;
      }
      case 4: {
        return AppColors.Red;
      }
      case 5: {
        return AppColors.PurpleBlue;
      }
    }
    // Do random else
    return '#' + Math.floor((Math.abs(Math.sin(index) * 16777215)) % 16777215).toString(16);
  }

  public getActivityColor(event: EventInterface, activity: ActivityInterface): string {
    return AppEventColorService.getColorByCreator(activity, activity.creator) ?
      AppEventColorService.getColorByCreator(activity, activity.creator) :
      AppEventColorService.getColorByIndex(event.getActivities().findIndex((eventActivity) => {
        return activity === eventActivity
      }));
  }
}
