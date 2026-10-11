import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Optional,
  Output,
  SimpleChanges
} from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { AppHapticsService } from '../../services/app.haptics.service';
import { type ActivityTypeFamilyFilterOption, getActivityTypeFamilyFilterOptions, isSameActivityTypeSelection, normalizeActivityTypeSelection, toggleActivityTypeFamilySelection } from '../../helpers/activity-type-family-filter.helper';
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

  @Input() selectedActivityTypes: ActivityTypes[] = [];
  @Input() availableActivityTypes: ActivityTypes[] | null | undefined;
  @Input() disabled = false;
  activityFamilyOptions: ActivityTypeFamilyFilterOption[] = [];
  @Input() label = 'Filter by activities';
  @Input() placeholder = 'Filter by activities';
  @Output() selectedActivityTypesChange: EventEmitter<ActivityTypes[]> = new EventEmitter<ActivityTypes[]>();

  activityTypesControl = new UntypedFormControl();

  private readonly catalogActivityTypes = ActivityTypesHelper.getActivityTypesAsUniqueArray()
    .map(value => ActivityTypesHelper.resolveActivityType(value))
    .filter((type): type is ActivityTypes => Boolean(type));

  activityTypesSelectionModelList: ActivityTypeSelectionModel[] = this.catalogActivityTypes
    .map(type => new ActivityTypeSelectionModel(type));

  selectedActivityTypesSelectionModel: ActivityTypeSelectionModel[] = new Array<ActivityTypeSelectionModel>();

  filteredActivityTypes: Observable<ActivityTypeSelectionModel[]>;
  lastFilter = '';
  private selectedActivityTypesSignature = '';

  constructor(private userService: AppUserService, @Optional() private haptics: AppHapticsService | null = null) {
  }

  ngOnInit() {
    this.filteredActivityTypes = this.activityTypesControl.valueChanges.pipe(
      startWith<string | ActivityTypeSelectionModel[]>(''),
      map(value => typeof value === 'string' ? value : this.lastFilter),
      map(filter => this.filter(filter))
    );
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.disabled) {
      if (this.disabled) this.activityTypesControl.disable({ emitEvent: false });
      else this.activityTypesControl.enable({ emitEvent: false });
    }
    const selectedActivityTypes = normalizeActivityTypeSelection(this.selectedActivityTypes || []);
    this.activityFamilyOptions = getActivityTypeFamilyFilterOptions(selectedActivityTypes, this.availableActivityTypes);
    this.selectedActivityTypes = selectedActivityTypes;
    const selectedActivityTypesSignature = selectedActivityTypes.join('|');
    if ((!changes.selectedActivityTypes && !changes.availableActivityTypes) || selectedActivityTypesSignature === this.selectedActivityTypesSignature) {
      if (changes.availableActivityTypes) this.activityTypesControl.updateValueAndValidity({ emitEvent: true });
      return;
    }

    this.setSelectionModels(selectedActivityTypes);
    // Refresh autocomplete choices after hydration without emitting a user
    // selection or feedback, including already-selected catalog bridge names.
    this.activityTypesControl.updateValueAndValidity({ emitEvent: true });
  }

  private setSelectionModels(selectedActivityTypes: ActivityTypes[], emitEvent = false): void {
    this.selectedActivityTypes = selectedActivityTypes;
    this.selectedActivityTypesSignature = selectedActivityTypes.join('|');
    this.activityFamilyOptions = getActivityTypeFamilyFilterOptions(selectedActivityTypes, this.availableActivityTypes);
    const previousModels = new Map(this.activityTypesSelectionModelList.map(model => [model.activityType, model]));
    this.activityTypesSelectionModelList = [...new Set([...this.catalogActivityTypes, ...selectedActivityTypes])]
      .map(type => previousModels.get(type) || new ActivityTypeSelectionModel(type));
    this.selectedActivityTypesSelectionModel = [];
    this.activityTypesSelectionModelList.forEach(model => { model.selected = false; });
    this.selectedActivityTypes.forEach(activityType => {
      const model = this.activityTypesSelectionModelList.find(ac => ac.activityType === activityType);
      if (model) {
        model.selected = true
        this.selectedActivityTypesSelectionModel.push(model)
      }
    })
    this.activityTypesControl.setValue(this.selectedActivityTypesSelectionModel, { emitEvent });
  }


  filter(filter: string): ActivityTypeSelectionModel[] {
    this.lastFilter = filter;
    const available = Array.isArray(this.availableActivityTypes)
      ? new Set(normalizeActivityTypeSelection([...this.availableActivityTypes, ...this.selectedActivityTypes])) : null;
    const models = this.activityTypesSelectionModelList.filter(model => !available || available.has(model.activityType));
    if (filter) {
      return models.filter(activityType => {
        return activityType.activityType.toLowerCase().indexOf(filter.toLowerCase()) !== -1
      })
    } else {
      return models.slice();
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

  toggleSelection(model: ActivityTypeSelectionModel) {
    if (this.disabled) return;
    const current = normalizeActivityTypeSelection(this.selectedActivityTypes);
    const next = model.selected ? current.filter(type => type !== model.activityType) : [...current, model.activityType];
    this.applyUserSelection(next);
  }

  toggleFamily(option: ActivityTypeFamilyFilterOption, checked: boolean): void {
    if (this.disabled) return;
    this.applyUserSelection(toggleActivityTypeFamilySelection(this.selectedActivityTypes, option, checked));
  }

  private applyUserSelection(next: ActivityTypes[]): void {
    if (isSameActivityTypeSelection(normalizeActivityTypeSelection(this.selectedActivityTypes), next)) return;
    this.setSelectionModels(next, true);
    this.haptics?.selection();
    this.selectedActivityTypesChange.emit(next);
  }

  clearSelection() {
    if (this.disabled) return;
    this.applyUserSelection([]);
  }
}
