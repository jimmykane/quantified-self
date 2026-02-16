import { ChangeDetectorRef } from '@angular/core';
import { DateRanges, DaysOfTheWeek } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { EventSearchComponent } from './event-search.component';

describe('EventSearchComponent', () => {
  const createComponent = () => {
    const changeDetectorRef = {
      markForCheck: vi.fn(),
      detectChanges: vi.fn(),
    } as unknown as ChangeDetectorRef;
    const component = new EventSearchComponent(changeDetectorRef);
    component.selectedDateRange = DateRanges.thisWeek;
    component.selectedStartDate = new Date('2025-01-01T00:00:00.000Z');
    component.selectedEndDate = new Date('2025-01-31T23:59:59.999Z');
    component.startOfTheWeek = DaysOfTheWeek.Monday;
    component.selectedActivityTypes = [];
    component.ngOnInit();
    return component;
  };

  it('should auto-search when a valid custom date change occurs', async () => {
    const component = createComponent();
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);

    await component.onDateChange({ value: new Date('2025-02-05T00:00:00.000Z') } as any);

    expect(component.selectedDateRange).toBe(DateRanges.custom);
    expect(searchSpy).toHaveBeenCalledTimes(1);
  });

  it('should not auto-search when one side of the range is missing', async () => {
    const component = createComponent();
    component.endDateControl.setValue(null);
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);

    await component.onDateChange({ value: new Date('2025-02-05T00:00:00.000Z') } as any);

    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('should set selected date range to custom when clicking date input area', () => {
    const component = createComponent();
    component.selectedDateRange = DateRanges.lastThirtyDays;

    component.setCustomDateRange();

    expect(component.selectedDateRange).toBe(DateRanges.custom);
  });
});
