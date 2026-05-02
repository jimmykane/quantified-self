import { SimpleChange } from '@angular/core';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { ActivityTypesFilterMenuComponent } from './activity-types-filter-menu.component';

describe('ActivityTypesFilterMenuComponent', () => {
  it('builds checkbox options from selected activity filters', () => {
    const component = new ActivityTypesFilterMenuComponent();
    component.selectedActivityTypes = [ActivityTypes.Running];

    component.ngOnChanges({
      selectedActivityTypes: new SimpleChange([], component.selectedActivityTypes, true),
    });

    expect(component.activityFilterLabel).toBe('1 activity filter');
    expect(component.activityTypeOptions.some(option => (
      option.value === ActivityTypes.Running && option.selected
    ))).toBe(true);
    expect(component.activityTypeOptions.some(option => (
      option.value === ActivityTypes.Cycling && option.selected
    ))).toBe(false);
  });

  it('emits toggled activity filters and updates local menu state', () => {
    const component = new ActivityTypesFilterMenuComponent();
    const emittedActivityTypes: ActivityTypes[][] = [];
    component.selectedActivityTypesChange.subscribe(activityTypes => emittedActivityTypes.push(activityTypes));
    component.selectedActivityTypes = [ActivityTypes.Running];
    component.ngOnChanges({
      selectedActivityTypes: new SimpleChange([], component.selectedActivityTypes, true),
    });

    component.onActivityTypeToggle(ActivityTypes.Cycling, true);
    component.onActivityTypeToggle(ActivityTypes.Running, false);

    expect(emittedActivityTypes).toEqual([
      [ActivityTypes.Running, ActivityTypes.Cycling],
      [ActivityTypes.Cycling],
    ]);
    expect(component.selectedActivityTypes).toEqual([ActivityTypes.Cycling]);
  });

  it('clears selected activity filters back to all activities', () => {
    const component = new ActivityTypesFilterMenuComponent();
    const emittedActivityTypes: ActivityTypes[][] = [];
    component.selectedActivityTypesChange.subscribe(activityTypes => emittedActivityTypes.push(activityTypes));
    component.selectedActivityTypes = [ActivityTypes.Running, ActivityTypes.Cycling];
    component.ngOnChanges({
      selectedActivityTypes: new SimpleChange([], component.selectedActivityTypes, true),
    });

    component.clearActivityTypes();

    expect(emittedActivityTypes).toEqual([[]]);
    expect(component.selectedActivityTypes).toEqual([]);
    expect(component.activityFilterLabel).toBe('All activities');
  });
});
