import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Optional, Output, SimpleChanges } from '@angular/core';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { AppHapticsService } from '../../services/app.haptics.service';
import { type ActivityTypeFamilyFilterOption, getActivityTypeFamilyFilterOptions, isSameActivityTypeSelection, normalizeActivityTypeSelection, toggleActivityTypeFamilySelection } from '../../helpers/activity-type-family-filter.helper';

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

  constructor(@Optional() private haptics: AppHapticsService | null = null) {}

  public activityFamilyOptions: ReadonlyArray<ActivityTypeFamilyFilterOption> = [];
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

    const current = normalizeActivityTypeSelection(this.selectedActivityTypes || []);
    const nextActivityTypes = checked
      ? Array.from(new Set([...current, activityType]))
      : current.filter(selectedActivityType => selectedActivityType !== activityType);

    this.applyUserSelection(nextActivityTypes);
  }

  clearActivityTypes(): void {
    if (this.disabled) {
      return;
    }

    if (!this.selectedActivityTypes.length) {
      return;
    }

    this.applyUserSelection([]);
  }

  onActivityFamilyToggle(option: ActivityTypeFamilyFilterOption): void {
    if (this.disabled) return;
    this.applyUserSelection(toggleActivityTypeFamilySelection(this.selectedActivityTypes, option, !option.selected));
  }

  private applyUserSelection(next: ActivityTypes[]): void {
    if (isSameActivityTypeSelection(normalizeActivityTypeSelection(this.selectedActivityTypes), next)) return;
    this.setSelectedActivityTypes(next);
    this.haptics?.selection();
    this.selectedActivityTypesChange.emit(next);
  }

  private setSelectedActivityTypes(activityTypes: ActivityTypes[]): void {
    const selectedActivityTypes = normalizeActivityTypeSelection(activityTypes || []);
    this.selectedActivityTypes = selectedActivityTypes;
    const selectedActivityTypeSet = new Set(selectedActivityTypes);
    const selectedCount = selectedActivityTypes.length;

    this.activityFilterLabel = selectedCount === 1
      ? '1 activity filter'
      : selectedCount > 1
        ? `${selectedCount} activity filters`
        : 'All activities';
    this.activityFamilyOptions = getActivityTypeFamilyFilterOptions(selectedActivityTypes, this.availableActivityTypes);
    const availableActivityTypes = this.getAvailableActivityTypeValues();
    this.activityTypeOptions = availableActivityTypes.map(activityType => ({
      label: activityType,
      selected: selectedActivityTypeSet.has(activityType),
      value: activityType,
    }));
  }

  private getAvailableActivityTypeValues(): ReadonlyArray<ActivityTypes> {
    // Already-selected canonical bridge names remain removable before the
    // catalog upgrade. They are not offered as new choices or family members.
    const catalogAndSelectedTypes = [...new Set([...this.activityTypeValues, ...this.selectedActivityTypes])];
    if (!Array.isArray(this.availableActivityTypes)) {
      return catalogAndSelectedTypes;
    }

    // Keep an existing filter in view even when a new context has no matching
    // activities. Removing it would silently turn a no-results state into an
    // unfiltered result set.
    const visibleActivityTypes = new Set(normalizeActivityTypeSelection([
      ...this.availableActivityTypes,
      ...this.selectedActivityTypes,
    ]));
    return catalogAndSelectedTypes.filter(activityType => visibleActivityTypes.has(activityType));
  }
}
