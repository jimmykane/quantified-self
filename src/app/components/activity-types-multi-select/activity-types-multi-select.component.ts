import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges
} from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../services/app.user.service';

export class ActivityTypeSelectionModel {
  constructor(public activityType: ActivityTypes, public selected = false) {
  }
}

/**
 * @title Multi-select autocomplete
 */
@Component({
    selector: 'app-activity-types-multi-select',
    templateUrl: 'activity-types-multi-select.component.html',
    styleUrls: ['activity-types-multi-select.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ActivityTypesMultiSelectComponent implements OnInit, OnChanges {

  @Input() selectedActivityTypes: ActivityTypes[];
  @Output() selectedActivityTypesChange: EventEmitter<ActivityTypes[]> = new EventEmitter<ActivityTypes[]>();

  activityTypesControl = new UntypedFormControl();

  activityTypesSelectionModelList: ActivityTypeSelectionModel[] = ActivityTypesHelper.getActivityTypesAsUniqueArray().map(a => new ActivityTypeSelectionModel(ActivityTypes[a]));

  selectedActivityTypesSelectionModel: ActivityTypeSelectionModel[] = new Array<ActivityTypeSelectionModel>();

  filteredActivityTypes: Observable<ActivityTypeSelectionModel[]>;
  lastFilter = '';

  constructor(private userService: AppUserService) {
  }

  ngOnInit() {

  }

  ngOnChanges(changes: SimpleChanges): void {
    this.selectedActivityTypes = this.selectedActivityTypes || [];
    this.filteredActivityTypes = this.activityTypesControl.valueChanges.pipe(
      startWith<string | ActivityTypeSelectionModel[]>(''),
      map(value => typeof value === 'string' ? value : this.lastFilter),
      map(filter => this.filter(filter))
    );
    this.selectedActivityTypesSelectionModel = [];
    this.selectedActivityTypes.forEach(activityType => {
      const model = this.activityTypesSelectionModelList.find(ac => ac.activityType === activityType);
      if (model) {
        model.selected = true
        this.selectedActivityTypesSelectionModel.push(model)
      }
    })
    this.activityTypesControl.setValue(this.selectedActivityTypesSelectionModel);
  }


  filter(filter: string): ActivityTypeSelectionModel[] {
    this.lastFilter = filter;
    if (filter) {
      return this.activityTypesSelectionModelList.filter(activityType => {
        return activityType.activityType.toLowerCase().indexOf(filter.toLowerCase()) !== -1
      })
    } else {
      return this.activityTypesSelectionModelList.slice();
    }
  }

  displayFn(value: ActivityTypeSelectionModel[] | ActivityTypeSelectionModel): string | undefined {
    let displayValue: string;
    if (!value) {
      return ''
    }
    if (Array.isArray(value)) {
      value.forEach((activityType, index) => {
        if (index === 0) {
          displayValue = activityType.activityType;
        } else {
          displayValue += ', ' + activityType.activityType;
        }
      });
    } else {
      displayValue = value.activityType || '';
    }
    return displayValue;
  }

  optionClicked(event: Event, activityTypeSelectionModel: ActivityTypeSelectionModel) {
    event.stopPropagation();
    this.toggleSelection(activityTypeSelectionModel);
  }

  toggleSelection(activityTypeSelectionModel: ActivityTypeSelectionModel) {
    activityTypeSelectionModel.selected = !activityTypeSelectionModel.selected;
    if (activityTypeSelectionModel.selected) {
      this.selectedActivityTypesSelectionModel.push(activityTypeSelectionModel);
    } else {
      const i = this.selectedActivityTypesSelectionModel.findIndex(value => value.activityType === activityTypeSelectionModel.activityType);
      this.selectedActivityTypesSelectionModel.splice(i, 1);
    }

    this.activityTypesControl.setValue(this.selectedActivityTypesSelectionModel);
    this.selectedActivityTypesChange.emit(this.activityTypesControl.value.map(a => a.activityType));
  }

  clearSelection() {
    this.selectedActivityTypesChange.emit([]);
  }
}
