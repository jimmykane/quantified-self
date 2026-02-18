import {Injectable} from '@angular/core';
import {SelectionModel} from '@angular/cdk/collections';
import {ActivityInterface} from '@sports-alliance/sports-lib';

@Injectable({
  providedIn: 'root',
})
export class AppActivitySelectionService {

  public selectedActivities: SelectionModel<ActivityInterface> = new SelectionModel(true);

  constructor() {
  }

  public findSelectedActivity(
    activity: ActivityInterface,
    selectedActivities: ActivityInterface[] = this.selectedActivities.selected,
  ): ActivityInterface | undefined {
    const activityID = activity?.getID?.();
    if (activityID) {
      return selectedActivities.find((selectedActivity) => selectedActivity?.getID?.() === activityID);
    }
    return selectedActivities.find((selectedActivity) => selectedActivity === activity);
  }

  public isActivitySelected(
    activity: ActivityInterface,
    selectedActivities: ActivityInterface[] = this.selectedActivities.selected,
  ): boolean {
    return !!this.findSelectedActivity(activity, selectedActivities);
  }

  public selectActivity(activity: ActivityInterface, selectedActivities: ActivityInterface[] = this.selectedActivities.selected): boolean {
    if (this.isActivitySelected(activity, selectedActivities)) {
      return false;
    }
    this.selectedActivities.select(activity);
    return true;
  }

  public deselectActivity(
    activity: ActivityInterface,
    selectedActivities: ActivityInterface[] = this.selectedActivities.selected,
    keepAtLeastOneSelected: boolean = false,
  ): boolean {
    const selectedActivityRef = this.findSelectedActivity(activity, selectedActivities);
    if (!selectedActivityRef) {
      return false;
    }
    if (keepAtLeastOneSelected && selectedActivities.length <= 1) {
      return false;
    }
    this.selectedActivities.deselect(selectedActivityRef);
    return true;
  }

  public toggleActivitySelection(
    activity: ActivityInterface,
    selectedActivities: ActivityInterface[] = this.selectedActivities.selected,
    keepAtLeastOneSelected: boolean = false,
  ): boolean {
    if (this.isActivitySelected(activity, selectedActivities)) {
      return this.deselectActivity(activity, selectedActivities, keepAtLeastOneSelected);
    }
    return this.selectActivity(activity, selectedActivities);
  }
}
