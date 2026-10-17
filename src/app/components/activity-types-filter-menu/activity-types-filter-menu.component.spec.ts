import { SimpleChange } from '@angular/core';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { ActivityTypesFilterMenuComponent } from './activity-types-filter-menu.component';
import { AppHapticsService } from '../../services/app.haptics.service';
import { CompatibleTrainingActivityTypes } from '@shared/activity-type-compatibility';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('ActivityTypesFilterMenuComponent', () => {
  it('builds checkbox options from selected activity filters', () => {
    const component = new ActivityTypesFilterMenuComponent();
    component.selectedActivityTypes = [ActivityTypes.Running];

    component.ngOnChanges({
      selectedActivityTypes: new SimpleChange([], component.selectedActivityTypes, true),
    });

    expect(component.activityFilterLabel).toBe('1 activity filter');
    expect(component.activityFilterAriaLabel).toBe('Filter activities: 1 activity filter');
    expect(component.activityTypeOptions.some(option => (
      option.value === ActivityTypes.Running && option.selected
    ))).toBe(true);
    expect(component.activityTypeOptions.some(option => (
      option.value === ActivityTypes.Cycling && option.selected
    ))).toBe(false);
    expect(component.activityTypeOptions.some(option => (
      option.value === ActivityTypes.Snorkeling
    ))).toBe(true);
    expect(component.activityTypeOptions.some(option => (
      option.value === ActivityTypes.Mermaiding
    ))).toBe(true);
  });

  it('limits options to a supplied context while keeping an active no-match filter visible', () => {
    const component = new ActivityTypesFilterMenuComponent();
    component.selectedActivityTypes = [ActivityTypes.Running];
    component.availableActivityTypes = [ActivityTypes.Cycling];

    component.ngOnChanges({
      selectedActivityTypes: new SimpleChange([], component.selectedActivityTypes, true),
      availableActivityTypes: new SimpleChange(undefined, component.availableActivityTypes, true),
    });

    expect(component.activityTypeOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: ActivityTypes.Cycling, selected: false }),
      expect.objectContaining({ value: ActivityTypes.Running, selected: true }),
    ]));
    expect(component.activityTypeOptions.some(option => option.value === ActivityTypes.Snorkeling)).toBe(false);
  });

  it('keeps a legacy activity-type alias selected in a narrowed menu', () => {
    const component = new ActivityTypesFilterMenuComponent();
    const emittedActivityTypes: ActivityTypes[][] = [];
    component.selectedActivityTypesChange.subscribe(activityTypes => emittedActivityTypes.push(activityTypes));
    component.selectedActivityTypes = ['cycling' as ActivityTypes];
    component.availableActivityTypes = [];

    component.ngOnChanges({
      selectedActivityTypes: new SimpleChange([], component.selectedActivityTypes, true),
      availableActivityTypes: new SimpleChange(undefined, component.availableActivityTypes, true),
    });

    expect(component.activityFilterLabel).toBe('1 activity filter');
    expect(component.activityTypeOptions).toEqual([
      expect.objectContaining({ value: ActivityTypes.Cycling, selected: true }),
    ]);

    component.onActivityTypeToggle(ActivityTypes.Cycling, false);

    expect(emittedActivityTypes).toEqual([[]]);
    expect(component.selectedActivityTypes).toEqual([]);
  });

  it('retains an already-selected catalog bridge as a removable exact choice', () => {
    const selection = vi.fn();
    const component = new ActivityTypesFilterMenuComponent({ selection } as unknown as AppHapticsService);
    const emit = vi.spyOn(component.selectedActivityTypesChange, 'emit');
    const savedType = CompatibleTrainingActivityTypes.RoadRunning;
    component.selectedActivityTypes = [savedType];
    component.availableActivityTypes = [];
    component.ngOnChanges({ selectedActivityTypes: new SimpleChange([], [savedType], true) });

    expect(component.selectedActivityTypes).toEqual([savedType]);
    expect(component.activityTypeOptions).toEqual([expect.objectContaining({ value: savedType, selected: true })]);
    expect(component.activityFamilyOptions).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
    expect(selection).not.toHaveBeenCalled();

    component.onActivityTypeToggle(savedType, true);
    expect(emit).not.toHaveBeenCalled();
    component.onActivityTypeToggle(savedType, false);
    expect(emit).toHaveBeenCalledExactlyOnceWith([]);
    expect(selection).toHaveBeenCalledTimes(1);
    expect(component.activityTypeOptions).toEqual([]);
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

  it('does not change activity filters while disabled', () => {
    const component = new ActivityTypesFilterMenuComponent();
    const emittedActivityTypes: ActivityTypes[][] = [];
    component.selectedActivityTypesChange.subscribe(activityTypes => emittedActivityTypes.push(activityTypes));
    component.selectedActivityTypes = [ActivityTypes.Running];
    component.disabled = true;
    component.ngOnChanges({
      selectedActivityTypes: new SimpleChange([], component.selectedActivityTypes, true),
    });

    component.onActivityTypeToggle(ActivityTypes.Cycling, true);
    component.clearActivityTypes();

    expect(emittedActivityTypes).toEqual([]);
    expect(component.selectedActivityTypes).toEqual([ActivityTypes.Running]);
    expect(component.activityFilterLabel).toBe('1 activity filter');
  });

  it('selects a contextual family, exposes partial selection and owns selection feedback', () => {
    const selection = vi.fn();
    const component = new ActivityTypesFilterMenuComponent({ selection } as unknown as AppHapticsService);
    component.selectedActivityTypes = [ActivityTypes.Running, ActivityTypes.Yoga];
    component.availableActivityTypes = [ActivityTypes.Running, ActivityTypes.Treadmill];
    component.ngOnChanges({ selectedActivityTypes: new SimpleChange([], component.selectedActivityTypes, true) });
    expect(selection).not.toHaveBeenCalled();
    const family = component.activityFamilyOptions[0];
    expect(family.partial).toBe(true);
    component.onActivityFamilyToggle(family);
    expect(component.selectedActivityTypes).toEqual([ActivityTypes.Running, ActivityTypes.Yoga, ActivityTypes.Treadmill]);
    expect(selection).toHaveBeenCalledTimes(1);
    component.onActivityTypeToggle(ActivityTypes.Treadmill, true);
    expect(selection).toHaveBeenCalledTimes(1);
    component.onActivityFamilyToggle(component.activityFamilyOptions[0]);
    expect(component.selectedActivityTypes).toEqual([ActivityTypes.Yoga]);
    expect(selection).toHaveBeenCalledTimes(2);
    component.disabled = true;
    component.onActivityFamilyToggle(family);
    component.clearActivityTypes();
    expect(selection).toHaveBeenCalledTimes(2);
  });

  it('renders partial family choices as accessible mixed checkboxes', () => {
    const template = readFileSync(join(process.cwd(), 'src/app/components/activity-types-filter-menu/activity-types-filter-menu.component.html'), 'utf8');
    expect(template).toContain("[attr.aria-checked]=\"family.partial ? 'mixed' : family.selected\"");
    expect(template).toContain('onActivityFamilyToggle(family)');
  });

  it('keeps the trigger accessible without a hover-created tooltip overlay', () => {
    const template = readFileSync(
      join(process.cwd(), 'src/app/components/activity-types-filter-menu/activity-types-filter-menu.component.html'),
      'utf8'
    );

    expect(template).toContain('[attr.aria-label]="activityFilterAriaLabel"');
    expect(template).not.toContain('matTooltip');
  });

  it('uses the all-activities row as the only visible clear action', () => {
    const template = readFileSync(
      join(process.cwd(), 'src/app/components/activity-types-filter-menu/activity-types-filter-menu.component.html'),
      'utf8'
    );

    expect(template).toContain('All activities');
    expect(template).not.toContain('activity-types-filter-clear-button');
    expect(template).not.toContain('Clear activity filters');
  });
});
