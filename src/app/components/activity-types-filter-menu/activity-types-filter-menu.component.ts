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
  /**
   * Optional context-specific choices. When omitted, the menu exposes the
   * complete supported activity-type catalog as it always has.
   */
  @Input() availableActivityTypes: ActivityTypes[] | null | undefined;
  @Input() disabled = false;
  @Input() ariaLabel = 'Filter activities';
  @Output() selectedActivityTypesChange = new EventEmitter<ActivityTypes[]>();

  public activityFilterLabel = 'All activities';
  public activityTypeOptions: ReadonlyArray<ActivityTypeFilterOption> = [];

  get activityFilterAriaLabel(): string {
    return `${this.ariaLabel}: ${this.activityFilterLabel}`;
  }

  private readonly activityTypeValues: ReadonlyArray<ActivityTypes> = Array.from(new Set(
    ActivityTypesHelper.getActivityTypesAsUniqueArray()
      .map(activityType => ActivityTypes[activityType as keyof typeof ActivityTypes])
      .filter((activityType): activityType is ActivityTypes => typeof activityType === 'string' && activityType.length > 0)
  ));

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['selectedActivityTypes'] && !changes['availableActivityTypes']) {
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
    const availableActivityTypes = this.getAvailableActivityTypeValues();
    this.activityTypeOptions = availableActivityTypes.map(activityType => ({
      label: activityType,
      selected: selectedActivityTypeSet.has(activityType),
      value: activityType,
    }));
  }

  private getAvailableActivityTypeValues(): ReadonlyArray<ActivityTypes> {
    if (!Array.isArray(this.availableActivityTypes)) {
      return this.activityTypeValues;
    }

    // Keep an existing filter in view even when a new context has no matching
    // activities. Removing it would silently turn a no-results state into an
    // unfiltered result set.
    const visibleActivityTypes = new Set([
      ...this.availableActivityTypes,
      ...this.selectedActivityTypes,
    ]);
    return this.activityTypeValues.filter(activityType => visibleActivityTypes.has(activityType));
  }
}
