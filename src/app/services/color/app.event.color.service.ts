import { Injectable } from '@angular/core';
import { AppDeviceColors } from './app.device.colors';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { AppActivityTypeGroupColors } from './app.activity-type-group.colors';
import type * as am4core from '@amcharts/amcharts4/core';
import { AppColors } from './app.colors';
import { AmChartsService } from '../am-charts.service';

@Injectable({
  providedIn: 'root',
})
export class AppEventColorService {

  constructor(private amChartsService: AmChartsService) { }

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

  getColorForActivityTypeByActivityTypeGroup(activityType: ActivityTypes): string {
    return AppActivityTypeGroupColors[ActivityTypesHelper.getActivityGroupForActivityType(activityType)];
  }

  getColorForZone(zone: string): am4core.Color | null {
    // Get the cached core module from the service (it will be loaded when charts are initialized)
    const core = this.amChartsService.getCachedCore();
    if (!core) {
      console.warn('amCharts core not loaded yet');
      return null;
    }

    switch (zone) {
      case `Zone 5`:
        return core.color(AppColors.LightRed);
      case `Zone 4`:
        return core.color(AppColors.Yellow);
      case `Zone 3`:
        return core.color(AppColors.Green);
      case `Zone 2`:
        return core.color(AppColors.Blue);
      case `Zone 1`:
      default:
        return core.color(AppColors.LightBlue);
    }
  }
}
