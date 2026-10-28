import { SimpleChange } from '@angular/core';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { DashboardTileEventFiltersComponent } from './dashboard-tile-event-filters.component';

describe('DashboardTileEventFiltersComponent', () => {
  it('uses compact labels for fixed current ranges in tile headers', () => {
    const component = new DashboardTileEventFiltersComponent();

    expect(component.rangeSelectorOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'thisWeek', label: 'Week', shortLabel: 'W', menuLabel: 'This week' }),
      expect.objectContaining({ value: 'thisMonth', label: 'Month', shortLabel: 'M', menuLabel: 'This month' }),
      expect.objectContaining({ value: 'lastMonth', label: 'Last month', shortLabel: 'Last mo', menuLabel: 'Last month' }),
      expect.objectContaining({ value: '7d', label: '7d', shortLabel: '7d', menuLabel: 'Last 7 days' }),
      expect.objectContaining({ value: '90d', label: '90d', shortLabel: '90d', menuLabel: '90d' }),
    ]));
  });

  it.each([
    ['7d', true],
    ['lastMonth', false],
  ] as const)('restores saved %s and exposes navigation only for rolling ranges', (range, showNavigation) => {
    const component = new DashboardTileEventFiltersComponent();
    component.eventFilters = { range, activityTypes: [] };
    const emittedRanges: string[] = [];
    const navigation: string[] = [];
    component.rangeChange.subscribe(value => emittedRanges.push(value));
    component.navigate.subscribe(value => navigation.push(value));

    component.ngOnChanges({ eventFilters: new SimpleChange(null, component.eventFilters, true) });
    expect(emittedRanges).toEqual([]);
    expect(component.selectedRange).toBe(range);
    expect(component.showNavigation).toBe(showNavigation);

    component.onNavigate('older');
    expect(navigation).toEqual(showNavigation ? ['older'] : []);
    component.onRangeSelection(range === '7d' ? 'lastMonth' : '7d');
    expect(emittedRanges).toEqual([range === '7d' ? 'lastMonth' : '7d']);
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
