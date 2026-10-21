import { ChangeDetectionStrategy, Component, EventEmitter, HostBinding, Input, OnChanges, Optional, Output } from '@angular/core';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { AppHapticsService } from '../../services/app.haptics.service';
import { getActivityTypeFamilyFilterOptions, isSameActivityTypeSelection, normalizeActivityTypeSelection } from '../../helpers/activity-type-family-filter.helper';
import type { ActivityFilterPickerOption, ActivityFilterPickerShortcut } from '../shared/activity-filter-picker/activity-filter-picker.component';

/** Supplies sport catalog and family choices to the shared searchable picker. */
@Component({
  selector: 'app-activity-types-multi-select',
  templateUrl: './activity-types-multi-select.component.html',
  styleUrls: ['./activity-types-multi-select.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ActivityTypesMultiSelectComponent implements OnChanges {
  @Input() selectedActivityTypes: ActivityTypes[] = [];
  @Input() availableActivityTypes: ActivityTypes[] | null | undefined;
  @Input() lockedActivityTypes: ActivityTypes[] = [];
  @Input() disabled = false;
  @Input() @HostBinding('class.is-compact') compact = false;
  @Input() label = 'Sports';
  @Input() ariaLabel?: string;
  @Input() emptyLabel = 'All sports';
  @Input() hint = '';
  @Input() lockedOptionDescription = 'Required selection';
  @Output() selectedActivityTypesChange = new EventEmitter<ActivityTypes[]>();

  options: ActivityFilterPickerOption[] = [];
  shortcuts: ActivityFilterPickerShortcut[] = [];
  private readonly catalog = normalizeActivityTypeSelection(ActivityTypesHelper.getActivityTypesAsUniqueArray());

  constructor(@Optional() private readonly haptics: AppHapticsService | null = null) {}

  ngOnChanges(): void { this.refreshOptions(); }

  selectSports(values: readonly string[]): void {
    if (this.disabled) return;
    const allowed = new Set(this.options.map(option => option.value));
    const next = normalizeActivityTypeSelection([...values.filter(value => allowed.has(value)), ...this.lockedActivityTypes]);
    if (isSameActivityTypeSelection(this.selectedActivityTypes, next)) return;
    this.selectedActivityTypes = next;
    this.refreshOptions();
    this.haptics?.selection();
    this.selectedActivityTypesChange.emit(next);
  }

  private refreshOptions(): void {
    const locked = new Set(normalizeActivityTypeSelection(this.lockedActivityTypes));
    this.selectedActivityTypes = normalizeActivityTypeSelection([...(this.selectedActivityTypes || []), ...locked]);
    const available = Array.isArray(this.availableActivityTypes) ? normalizeActivityTypeSelection(this.availableActivityTypes) : this.catalog;
    // Keep saved no-match and catalog bridge choices removable without widening a context's sport families.
    const choices = normalizeActivityTypeSelection([...available, ...this.selectedActivityTypes]);
    this.options = choices.sort((a, b) => a.localeCompare(b)).map(sport => ({
      value: sport, label: sport, activityType: sport, disabled: locked.has(sport),
      description: locked.has(sport) ? this.lockedOptionDescription : undefined,
    }));
    this.shortcuts = getActivityTypeFamilyFilterOptions(this.selectedActivityTypes, available)
      .map(family => ({ label: family.label, values: family.activityTypes }));
  }
}
