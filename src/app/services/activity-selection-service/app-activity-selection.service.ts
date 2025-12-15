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
}
