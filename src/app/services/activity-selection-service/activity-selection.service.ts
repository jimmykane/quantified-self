import {Injectable} from '@angular/core';
import {SelectionModel} from '@angular/cdk/collections';
import {ActivityInterface} from '@sports-alliance/sports-lib/lib/activities/activity.interface';

@Injectable()
export class ActivitySelectionService {

  public selectedActivities: SelectionModel<ActivityInterface> = new SelectionModel(true);

  constructor() {
  }
}
