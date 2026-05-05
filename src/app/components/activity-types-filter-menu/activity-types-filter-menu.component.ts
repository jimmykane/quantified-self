import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';

interface ActivityTypeFilterOption {
  label: string;
  selected: boolean;
  value: ActivityTypes;
}

@Component({
  selector: 'app-activity-types-filter-menu',
  templateUrl: './activity-types-filter-menu.component.html',
  styleUrls: ['./activity-types-filter-menu.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ActivityTypesFilterMenuComponent implements OnChanges {
  @Input() selectedActivityTypes: ActivityTypes[] = [];
  @Input() disabled = false;
  @Input() ariaLabel = 'Filter activities';
  @Output() selectedActivityTypesChange = new EventEmitter<ActivityTypes[]>();

  public activityFilterLabel = 'All activities';
  public activityTypeOptions: ReadonlyArray<ActivityTypeFilterOption> = [];

  private readonly activityTypeValues: ReadonlyArray<ActivityTypes> = Array.from(new Set(
    ActivityTypesHelper.getActivityTypesAsUniqueArray()
      .map(activityType => ActivityTypes[activityType as keyof typeof ActivityTypes])
      .filter((activityType): activityType is ActivityTypes => typeof activityType === 'string' && activityType.length > 0)
  ));

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['selectedActivityTypes']) {
      return;
    }
    this.setSelectedActivityTypes(this.selectedActivityTypes || []);
  }

  onActivityTypeToggle(activityType: ActivityTypes, checked: boolean): void {
    if (this.disabled) {
      return;
    }

    const current = this.selectedActivityTypes || [];
    const nextActivityTypes = checked
      ? Array.from(new Set([...current, activityType]))
      : current.filter(selectedActivityType => selectedActivityType !== activityType);

    this.setSelectedActivityTypes(nextActivityTypes);
    this.selectedActivityTypesChange.emit(nextActivityTypes);
  }

  clearActivityTypes(): void {
    if (this.disabled) {
      return;
    }

    if (!this.selectedActivityTypes.length) {
      return;
    }

    this.setSelectedActivityTypes([]);
    this.selectedActivityTypesChange.emit([]);
  }

  private setSelectedActivityTypes(activityTypes: ActivityTypes[]): void {
    this.selectedActivityTypes = activityTypes || [];
    const selectedActivityTypeSet = new Set(this.selectedActivityTypes);
    const selectedCount = this.selectedActivityTypes.length;

    this.activityFilterLabel = selectedCount === 1
      ? '1 activity filter'
      : selectedCount > 1
        ? `${selectedCount} activity filters`
        : 'All activities';
    this.activityTypeOptions = this.activityTypeValues.map(activityType => ({
      label: activityType,
      selected: selectedActivityTypeSet.has(activityType),
      value: activityType,
    }));
  }
}
