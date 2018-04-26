import {Injectable} from '@angular/core';
import {EventInterface} from '../../entities/events/event.interface';
import {ActivityInterface} from '../../entities/activities/activity.interface';
import {CreatorInterface} from '../../entities/creators/creatorInterface';
import {ImporterSuuntoDeviceNames} from '../../entities/events/adapters/importers/suunto/importer.suunto.device.names';
import {AppColors} from './app.colors';


@Injectable()
export class AppEventColorService {

  private static getColorByCreator(activity: ActivityInterface, creator: CreatorInterface): string {
    if (creator.name.includes(ImporterSuuntoDeviceNames['Suunto Ambit 3 Sport'])) {
      return AppColors.Orange;
    }
    if (creator.name.includes(ImporterSuuntoDeviceNames['Suunto Ambit 3 Peak'])) {
      return AppColors.Orange;
    }
    if (creator.name.includes('Ibiza')) {
      return AppColors.Green;
    }
    if (creator.name.includes(ImporterSuuntoDeviceNames.Amsterdam)) {
      return AppColors.Blue;
    }
    if (creator.name.includes(ImporterSuuntoDeviceNames.Helsinki)) {
      return AppColors.Pink;

    }
    if (creator.name.includes(ImporterSuuntoDeviceNames.Forssa)) {
      return AppColors.Purple;
    }
    if (creator.name.includes(ImporterSuuntoDeviceNames.Brighton)) {
      return AppColors.PurpleBlue;

    }
    if (creator.name.includes(ImporterSuuntoDeviceNames.Gdansk)) {
      return AppColors.Red;
    }
    if (creator.name.includes(ImporterSuuntoDeviceNames.Cairo)) {
      return AppColors.LightGreen;
    }
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
