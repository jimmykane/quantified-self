import { SimpleChange } from '@angular/core';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { DashboardTileEventFiltersComponent } from './dashboard-tile-event-filters.component';

describe('DashboardTileEventFiltersComponent', () => {
  it('uses compact labels for fixed current ranges in tile headers', () => {
    const component = new DashboardTileEventFiltersComponent();

    expect(component.rangeSelectorOptions).toEqual(expect.arrayContaining([
      { value: 'thisWeek', label: 'Week' },
      { value: 'thisMonth', label: 'Month' },
      { value: '90d', label: '90d' },
    ]));
  });

  it('passes saved activity filters through to the shared activity menu', () => {
    const component = new DashboardTileEventFiltersComponent();
    component.eventFilters = {
      range: '90d',
      activityTypes: [ActivityTypes.Running],
    };

    component.ngOnChanges({
      eventFilters: new SimpleChange(null, component.eventFilters, true),
    });

    expect(component.selectedActivityTypes).toEqual([ActivityTypes.Running]);
  });

  it('emits activity filters selected by the shared activity menu', () => {
    const component = new DashboardTileEventFiltersComponent();
    const emittedActivityTypes: ActivityTypes[][] = [];
    component.activityTypesChange.subscribe(activityTypes => emittedActivityTypes.push(activityTypes));
    component.eventFilters = {
      range: '90d',
      activityTypes: [ActivityTypes.Running],
    };
    component.ngOnChanges({
      eventFilters: new SimpleChange(null, component.eventFilters, true),
    });

    component.onActivityTypesChange([ActivityTypes.Running, ActivityTypes.Cycling]);
    component.onActivityTypesChange([ActivityTypes.Cycling]);

    expect(emittedActivityTypes).toEqual([
      [ActivityTypes.Running, ActivityTypes.Cycling],
      [ActivityTypes.Cycling],
    ]);
    expect(component.selectedActivityTypes).toEqual([ActivityTypes.Cycling]);
  });

  it('passes clearing from the shared activity menu through as all activities', () => {
    const component = new DashboardTileEventFiltersComponent();
    const emittedActivityTypes: ActivityTypes[][] = [];
    component.activityTypesChange.subscribe(activityTypes => emittedActivityTypes.push(activityTypes));
    component.eventFilters = {
      range: '90d',
      activityTypes: [ActivityTypes.Running, ActivityTypes.Cycling],
    };
    component.ngOnChanges({
      eventFilters: new SimpleChange(null, component.eventFilters, true),
    });

    component.onActivityTypesChange([]);

    expect(emittedActivityTypes).toEqual([[]]);
    expect(component.selectedActivityTypes).toEqual([]);
  });
});
