import { Injectable } from '@angular/core';
import { AppDeviceColors } from './app.device.colors';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { AppActivityTypeGroupColors } from './app.activity-type-group.colors';
import { AppActivityTypeGroupGradients } from './app.activity-type-group.gradients';
import type * as am4core from '@amcharts/amcharts4/core';
import { AppColors } from './app.colors';
import { AmChartsService } from '../am-charts.service';
import { LoggerService } from '../logger.service';

@Injectable({
  providedIn: 'root',
})
export class AppEventColorService {

  private colorCache = new WeakMap<ActivityInterface[], Map<ActivityInterface, string>>();

  constructor(private amChartsService: AmChartsService, private logger: LoggerService) { }

  public getDifferenceColor(percent: number): string {
    if (percent <= 2) {
      return AppColors.Green;
    } else if (percent <= 5) {
      return AppColors.Orange;
    } else {
      return AppColors.Red;
    }
  }

  /**
   * Clears the color cache. Should be called when activities change context (e.g. new event load)
   */
  public clearCache() {
    this.colorCache = new WeakMap<ActivityInterface[], Map<ActivityInterface, string>>();
  }

  public getColorByNumber(number: number): string {
    // Return fixed random
    return '#' + Math.floor((Math.abs(Math.sin(number) * 16777215)) % 16777215).toString(16);
  }

  /**
   * Get the color for an activity from the pre-calculated map.
   */
  public getActivityColor(activities: ActivityInterface[], activity: ActivityInterface): string {
    const activityID = activity.getID();
    const creatorName = activity.creator.name || 'Unknown';

    let eventColorCache = this.colorCache.get(activities);
    if (!eventColorCache) {
      eventColorCache = new Map<ActivityInterface, string>();
      this.colorCache.set(activities, eventColorCache);
    }
    if (eventColorCache.has(activity)) {
      return eventColorCache.get(activity)!;
    }

    // Get the index of the requested activity among all activities
    // Prefer reference matching first to avoid collisions with duplicate IDs.
    let activityIndex = activities.indexOf(activity);
    if (activityIndex === -1 && activityID) {
      activityIndex = activities.findIndex((eventActivity) => eventActivity.getID() === activityID);
    }

    // If still not found, return a default color based on a safe fallback
    if (activityIndex === -1) {
      this.logger.warn('[AppEventColorService] Activity not found in provided array, using default offset');
      activityIndex = activities.length + this.getColorSeedFromText(`${creatorName}-${activityID || 'no-id'}`);
    }

    const deviceColors = AppDeviceColors as any;

    if (!deviceColors[creatorName]) {
      const color = this.getColorByNumber(activityIndex + 5 /* + 10 = pretty */);

      eventColorCache.set(activity, color);
      return color;
    }

    // Find the activities that have the same creator
    const sameCreatorActivities = activities.filter(eventActivity => eventActivity.creator.name === creatorName);
    // Get the index on the same creator activities
    let sameCreatorActivitiesActivityIndex = sameCreatorActivities.indexOf(activity);
    if (sameCreatorActivitiesActivityIndex === -1 && activityID) {
      sameCreatorActivitiesActivityIndex = sameCreatorActivities.findIndex((eventActivity) => eventActivity.getID() === activityID);
    }



    // If its the first one return the color
    if (sameCreatorActivitiesActivityIndex === 0) {
      const color = deviceColors[creatorName];

      eventColorCache.set(activity, color);
      return color;
    }

    // Else it's not the first one, then return the global activity index color
    const color = this.getColorByNumber(activityIndex);

    eventColorCache.set(activity, color);
    return color;
  }

  private getColorSeedFromText(text: string): number {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash << 5) - hash + text.charCodeAt(index);
      hash |= 0;
    }
    return Math.abs(hash) + 1;
  }

  getColorForActivityTypeByActivityTypeGroup(activityType: ActivityTypes): string {
    return AppActivityTypeGroupColors[ActivityTypesHelper.getActivityGroupForActivityType(activityType)];
  }

  /**
   * Returns a CSS linear-gradient string for the given activity type.
   */
  getGradientForActivityTypeGroup(activityType: ActivityTypes): string {
    const group = ActivityTypesHelper.getActivityGroupForActivityType(activityType);
    const gradient = AppActivityTypeGroupGradients[group];
    if (gradient) {
      return `linear-gradient(135deg, ${gradient.start}, ${gradient.end})`;
    }
    // Fallback to solid color if gradient not defined
    const solid = AppActivityTypeGroupColors[group] || '#999';
    return `linear-gradient(135deg, ${solid}, ${solid})`;
  }

  getColorForZoneHex(zone: string): string {
    switch (zone) {
      case `Zone 7`:
      case `Z7`:
        return AppColors.Purple;
      case `Zone 6`:
      case `Z6`:
        return AppColors.Red;
      case `Zone 5`:
      case `Z5`:
        return AppColors.LightestRed;
      case `Zone 4`:
      case `Z4`:
        return AppColors.Yellow;
      case `Zone 3`:
      case `Z3`:
        return AppColors.Green;
      case `Zone 2`:
      case `Z2`:
        return AppColors.Blue;
      case `Zone 1`:
      case `Z1`:
      default:
        return AppColors.LightBlue;
    }
  }

  getColorForZone(zone: string): am4core.Color | null {
    // Get the cached core module from the service (it will be loaded when charts are initialized)
    const core = this.amChartsService.getCachedCore();
    if (!core) {
      this.logger.warn('amCharts core not loaded yet');
      return null;
    }

    return core.color(this.getColorForZoneHex(zone));
  }
}
