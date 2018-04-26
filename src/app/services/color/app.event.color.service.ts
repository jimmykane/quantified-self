import {Injectable} from '@angular/core';
import {EventInterface} from '../entities/events/event.interface';
import {ActivityInterface} from '../entities/activities/activity.interface';
import {CreatorInterface} from '../entities/creators/creatorInterface';
import {ImporterSuuntoDeviceNames} from '../entities/events/adapters/importers/suunto/importer.suunto.device.names';


@Injectable()
export class AppEventColorService {

  private static getColorByCreator(activity: ActivityInterface, creator: CreatorInterface): string {
    if (creator.name.includes(ImporterSuuntoDeviceNames['Suunto Ambit 3 Sport'])) {
      return '#FFA500';
    }
    if (creator.name.includes(ImporterSuuntoDeviceNames['Suunto Ambit 3 Peak'])) {
      return '#FFA500';
    }
    if (creator.name.includes('Ibiza')) {
      return '#3fd532';
    }
    if (creator.name.includes(ImporterSuuntoDeviceNames.Amsterdam)) {
      return '#00008B';
    }
    if (creator.name.includes(ImporterSuuntoDeviceNames.Helsinki)) {
      return '#FF00FF';

    }
    if (creator.name.includes(ImporterSuuntoDeviceNames.Forssa)) {
      return '#800080';

    }
    if (creator.name.includes(ImporterSuuntoDeviceNames.Brighton)) {
      return '#a4a8f5';

    }
    if (creator.name.includes(ImporterSuuntoDeviceNames.Gdansk)) {
      return '#cb410f';
    }
    if (creator.name.includes(ImporterSuuntoDeviceNames.Cairo)) {
      return '#82cca1';
    }
  }

  private static getColorByIndex(index: number): string {
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

  public getActivityColor(event: EventInterface, activity: ActivityInterface): string {
    return AppEventColorService.getColorByCreator(activity, activity.creator) ?
      AppEventColorService.getColorByCreator(activity, activity.creator) :
      AppEventColorService.getColorByIndex(event.getActivities().findIndex((eventActivity) => {
        return activity === eventActivity
      }));
  }
}
