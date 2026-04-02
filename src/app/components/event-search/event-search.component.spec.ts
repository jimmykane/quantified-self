import { ChangeDetectorRef } from '@angular/core';
import { DateRanges, DaysOfTheWeek } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { getDatesForDateRange } from '../../helpers/date-range-helper';
import { EventSearchComponent } from './event-search.component';

describe('EventSearchComponent', () => {
  const createComponent = (dialog?: { open: ReturnType<typeof vi.fn> }) => {
    const changeDetectorRef = {
      markForCheck: vi.fn(),
      detectChanges: vi.fn(),
    } as unknown as ChangeDetectorRef;
    const component = new EventSearchComponent(changeDetectorRef, dialog as any);
    component.selectedDateRange = DateRanges.thisWeek;
    component.selectedStartDate = new Date('2025-01-01T00:00:00.000Z');
    component.selectedEndDate = new Date('2025-01-31T23:59:59.999Z');
    component.startOfTheWeek = DaysOfTheWeek.Monday;
    component.selectedActivityTypes = [];
    component.ngOnInit();
    return component;
  };

  it('should update selected range and trigger search when a date toggle is selected', async () => {
    const component = createComponent();
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);
    const event = {
      source: { value: DateRanges.lastWeek },
    } as any;

    await component.dateToggleChange(event);

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(component.selectedDateRange).toBe(DateRanges.lastWeek);
  });

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

  it('should not auto-search when end date input is invalid', async () => {
    const component = createComponent();
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);
    component.endDateControl.setErrors({ matEndDateInvalid: true });

    await component.onDateChange({ value: new Date('2025-02-05T00:00:00.000Z') } as any);

    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('should set selected date range to custom when clicking date input area', () => {
    const component = createComponent();
    component.selectedDateRange = DateRanges.lastThirtyDays;

    component.setCustomDateRange();

    expect(component.selectedDateRange).toBe(DateRanges.custom);
  });

  it('should block submit when end date is before start date', async () => {
    const component = createComponent();
    const emitSpy = vi.spyOn(component.searchChange, 'emit');
    component.selectedDateRange = DateRanges.custom;
    component.startDateControl.setValue(new Date('2025-02-10T00:00:00.000Z'));
    component.endDateControl.setValue(new Date('2025-02-01T00:00:00.000Z'));
    component.searchFormGroup.updateValueAndValidity();

    await component.search();

    expect(component.searchFormGroup.hasError('endDateSmallerThanStartDate')).toBe(true);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should keep the helper end date for preset ranges', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));
    try {
      const component = createComponent();
      const emitSpy = vi.spyOn(component.searchChange, 'emit');
      const event = {
        source: { value: DateRanges.lastSevenDays },
      } as any;

      await component.dateToggleChange(event);

      const expected = getDatesForDateRange(DateRanges.lastSevenDays, DaysOfTheWeek.Monday);
      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy.mock.calls[0][0].startDate?.getTime()).toBe(expected.startDate?.getTime());
      expect(emitSpy.mock.calls[0][0].endDate?.getTime()).toBe(expected.endDate?.getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it('should include merged events when merged toggle changes', async () => {
    const component = createComponent();
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);
    const event = {
      value: ['merged'],
    } as any;

    await component.onMergedEventsToggleChange(event);

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(component.includeMergedEvents).toBe(true);
  });

  it('should not search when merged toggle is disabled', async () => {
    const component = createComponent();
    component.mergedEventsToggleDisabled = true;
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);
    const event = {
      value: [],
    } as any;

    await component.onMergedEventsToggleChange(event);

    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('should show a performance warning dialog when selecting all date range and continue on confirm', async () => {
    const dialog = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of(true),
      }),
    };
    const component = createComponent(dialog);
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);

    await component.dateToggleChange({
      source: { value: DateRanges.all },
    } as any);

    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(component.selectedDateRange).toBe(DateRanges.all);
  });

  it('should keep previous date range and skip search when all date range warning is cancelled', async () => {
    const dialog = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of(false),
      }),
    };
    const component = createComponent(dialog);
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);
    const previousRange = component.selectedDateRange;
    const previousStartMs = component.startDateControl.value?.getTime?.();
    const previousEndMs = component.endDateControl.value?.getTime?.();

    await component.dateToggleChange({
      source: { value: DateRanges.all },
    } as any);

    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(searchSpy).not.toHaveBeenCalled();
    expect(component.selectedDateRange).toBe(previousRange);
    expect(component.startDateControl.value?.getTime?.()).toBe(previousStartMs);
    expect(component.endDateControl.value?.getTime?.()).toBe(previousEndMs);
  });

  it('should keep custom start/end dates when all date range warning is cancelled', async () => {
    const dialog = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of(false),
      }),
    };
    const component = createComponent(dialog);
    component.selectedDateRange = DateRanges.custom;
    component.selectedStartDate = new Date('2025-02-01T00:00:00.000Z');
    component.selectedEndDate = new Date('2025-02-28T23:59:59.999Z');
    component.startDateControl.setValue(component.selectedStartDate);
    component.endDateControl.setValue(component.selectedEndDate);
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);

    await component.dateToggleChange({
      source: { value: DateRanges.all },
    } as any);

    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(searchSpy).not.toHaveBeenCalled();
    expect(component.selectedDateRange).toBe(DateRanges.custom);
    expect(component.startDateControl.value?.getTime?.()).toBe(component.selectedStartDate.getTime());
    expect(component.endDateControl.value?.getTime?.()).toBe(component.selectedEndDate.getTime());
  });
});
