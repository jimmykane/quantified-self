import { Injectable } from '@angular/core';
import { AppDeviceColors } from './app.device.colors';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { AppActivityTypeGroupColors } from './app.activity-type-group.colors';
import type * as am4core from '@amcharts/amcharts4/core';
import { AppColors } from './app.colors';
import { AmChartsService } from '../am-charts.service';
import { LoggerService } from '../logger.service';

@Injectable({
  providedIn: 'root',
})
export class AppEventColorService {

  constructor(private amChartsService: AmChartsService, private logger: LoggerService) { }

  public getColorByNumber(number: number): string {
    // Return fixed random
    return '#' + Math.floor((Math.abs(Math.sin(number) * 16777215)) % 16777215).toString(16);
  }

  public getActivityColor(activities: ActivityInterface[], activity: ActivityInterface): string {
    const activityID = activity.getID();
    const creatorName = activity.creator.name || 'Unknown';

    // Get the index of the requested activity among all activities
    // If ID is missing, fallback to reference matching or index-in-array if possible
    let activityIndex = activities.findIndex((eventActivity) => {
      const id = eventActivity.getID();
      return activityID && id ? activityID === id : activity === eventActivity;
    });

    // If still not found, return a default color based on a safe fallback
    if (activityIndex === -1) {
      this.logger.warn('[AppEventColorService] Activity not found in provided array, using default offset');
      activityIndex = 0;
    }

    this.logger.log('[AppEventColorService] getActivityColor', {
      activityID,
      activityIndex,
      creator: creatorName,
      totalActivities: activities.length
    });

    const deviceColors = AppDeviceColors as any;

    if (!deviceColors[creatorName]) {
      const color = this.getColorByNumber(activityIndex + 5 /* + 10 = pretty */);
      this.logger.log('[AppEventColorService] No device color, using fallback:', color);
      return color;
    }

    // Find the activities that have the same creator
    const sameCreatorActivities = activities.filter(eventActivity => eventActivity.creator.name === creatorName);
    // Get the index on the same creator activities
    const sameCreatorActivitiesActivityIndex = sameCreatorActivities.findIndex((eventActivity) => {
      const id = eventActivity.getID();
      return activityID && id ? activityID === id : activity === eventActivity;
    });

    this.logger.log('[AppEventColorService] sameCreator index:', sameCreatorActivitiesActivityIndex);

    // If its the first one return the color
    if (sameCreatorActivitiesActivityIndex === 0) {
      const color = deviceColors[creatorName];
      this.logger.log('[AppEventColorService] First for creator, using device color:', color);
      return color;
    }

    // Else it's not the first one, then return the global activity index color
    const color = this.getColorByNumber(activityIndex);
    this.logger.log('[AppEventColorService] Subsequent for creator, using unique color:', color);
    return color;
  }

  getColorForActivityTypeByActivityTypeGroup(activityType: ActivityTypes): string {
    return AppActivityTypeGroupColors[ActivityTypesHelper.getActivityGroupForActivityType(activityType)];
  }

  getColorForZone(zone: string): am4core.Color | null {
    // Get the cached core module from the service (it will be loaded when charts are initialized)
    const core = this.amChartsService.getCachedCore();
    if (!core) {
      this.logger.warn('amCharts core not loaded yet');
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
