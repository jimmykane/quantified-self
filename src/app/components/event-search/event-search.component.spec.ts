import { ChangeDetectorRef } from '@angular/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DateRanges, DaysOfTheWeek } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { getDatesForDateRange } from '../../helpers/date-range-helper';
import { EventSearchComponent } from './event-search.component';

describe('EventSearchComponent', () => {
  const createComponent = (
    dialog?: { open: ReturnType<typeof vi.fn> },
    configure?: (component: EventSearchComponent) => void,
  ) => {
    const changeDetectorRef = {
      markForCheck: vi.fn(),
      detectChanges: vi.fn(),
    } as unknown as ChangeDetectorRef;
    const hapticsService = {
      selection: vi.fn(),
    };
    const component = new EventSearchComponent(changeDetectorRef, dialog as any, hapticsService as any);
    component.selectedDateRange = DateRanges.thisWeek;
    component.selectedStartDate = new Date('2025-01-01T00:00:00.000Z');
    component.selectedEndDate = new Date('2025-01-31T23:59:59.999Z');
    component.startOfTheWeek = DaysOfTheWeek.Monday;
    component.selectedActivityTypes = [];
    configure?.(component);
    component.ngOnInit();
    return { component, hapticsService };
  };

  it('should update selected range and trigger search when a date toggle is selected', async () => {
    const { component, hapticsService } = createComponent();
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);
    const event = {
      source: { value: DateRanges.lastWeek },
    } as any;

    await component.dateToggleChange(event);

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(component.selectedDateRange).toBe(DateRanges.lastWeek);
    expect(hapticsService.selection).toHaveBeenCalledTimes(1);
  });

  it('should expose one flattened shortcut group for table toolbar layout', () => {
    const { component } = createComponent(undefined, searchComponent => {
      searchComponent.compact = true;
      searchComponent.toolbarRangeLayout = true;
    });

    expect(component.primaryToolbarDateRangeOptions.map(option => option.label)).toEqual([
      'This wk',
      'Last wk',
      '7d',
      'This mo',
      'Last mo',
      '30d',
    ]);
    expect(component.secondaryToolbarDateRangeOptions.map(option => option.label)).toEqual([
      `${component.currentYear}`,
      `${component.currentYear - 1}`,
      'All',
    ]);
    expect(component.secondaryDateRangeButtonLabel).toBe('More');
  });

  it('should use a mobile grid for table toolbar date shortcuts so labels do not collide', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/event-search/event-search.component.scss'),
      'utf8',
    );

    expect(styles).toContain(':host(.table-toolbar-layout) .toolbar-range-group');
    expect(styles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
  });

  it('should update the secondary range menu label when a secondary shortcut is selected', async () => {
    const { component, hapticsService } = createComponent(undefined, searchComponent => {
      searchComponent.compact = true;
      searchComponent.toolbarRangeLayout = true;
    });
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);

    await component.onSecondaryDateRangeSelection(DateRanges.lastYear);

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(component.selectedDateRange).toBe(DateRanges.lastYear);
    expect(component.secondaryDateRangeButtonLabel).toBe(`${component.currentYear - 1}`);
    expect(hapticsService.selection).toHaveBeenCalledTimes(1);
  });

  it('should reuse the all-range warning for secondary toolbar shortcuts', async () => {
    const dialog = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of(true),
      }),
    };
    const { component } = createComponent(dialog, searchComponent => {
      searchComponent.compact = true;
      searchComponent.toolbarRangeLayout = true;
    });
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);

    await component.onSecondaryDateRangeSelection(DateRanges.all);

    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(component.selectedDateRange).toBe(DateRanges.all);
    expect(component.secondaryDateRangeButtonLabel).toBe('All');
  });

  it('should require confirmation when selecting all from the table toolbar even if all is already active', async () => {
    const dialog = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of(false),
      }),
    };
    const { component } = createComponent(dialog, searchComponent => {
      searchComponent.selectedDateRange = DateRanges.all;
      searchComponent.compact = true;
      searchComponent.toolbarRangeLayout = true;
    });
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);

    await component.onSecondaryDateRangeSelection(DateRanges.all);

    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(searchSpy).not.toHaveBeenCalled();
    expect(component.selectedDateRange).toBe(DateRanges.all);
    expect(component.secondaryDateRangeButtonLabel).toBe('All');
  });

  it('should auto-search when a valid custom date change occurs', async () => {
    const { component, hapticsService } = createComponent();
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);

    await component.onDateChange({ value: new Date('2025-02-05T00:00:00.000Z') } as any);

    expect(component.selectedDateRange).toBe(DateRanges.custom);
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(hapticsService.selection).toHaveBeenCalledTimes(1);
  });

  it('should not auto-search when one side of the range is missing', async () => {
    const { component, hapticsService } = createComponent();
    component.endDateControl.setValue(null);
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);

    await component.onDateChange({ value: new Date('2025-02-05T00:00:00.000Z') } as any);

    expect(searchSpy).not.toHaveBeenCalled();
    expect(hapticsService.selection).not.toHaveBeenCalled();
  });

  it('should not auto-search when end date input is invalid', async () => {
    const { component, hapticsService } = createComponent();
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);
    component.endDateControl.setErrors({ matEndDateInvalid: true });

    await component.onDateChange({ value: new Date('2025-02-05T00:00:00.000Z') } as any);

    expect(searchSpy).not.toHaveBeenCalled();
    expect(hapticsService.selection).not.toHaveBeenCalled();
  });

  it('should set selected date range to custom when clicking date input area', () => {
    const { component, hapticsService } = createComponent();
    component.selectedDateRange = DateRanges.lastThirtyDays;

    component.setCustomDateRange();

    expect(component.selectedDateRange).toBe(DateRanges.custom);
    expect(hapticsService.selection).toHaveBeenCalledTimes(1);
  });

  it('should block submit when end date is before start date', async () => {
    const { component } = createComponent();
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
      const { component } = createComponent();
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
    const { component, hapticsService } = createComponent();
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);
    const event = {
      value: ['merged'],
    } as any;

    await component.onMergedEventsToggleChange(event);

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(component.includeMergedEvents).toBe(true);
    expect(hapticsService.selection).toHaveBeenCalledTimes(1);
  });

  it('should not search when merged toggle is disabled', async () => {
    const { component, hapticsService } = createComponent();
    component.mergedEventsToggleDisabled = true;
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);
    const event = {
      value: [],
    } as any;

    await component.onMergedEventsToggleChange(event);

    expect(searchSpy).not.toHaveBeenCalled();
    expect(hapticsService.selection).not.toHaveBeenCalled();
  });

  it('should show a performance warning dialog when selecting all date range and continue on confirm', async () => {
    const dialog = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of(true),
      }),
    };
    const { component, hapticsService } = createComponent(dialog);
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);

    await component.dateToggleChange({
      source: { value: DateRanges.all },
    } as any);

    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(component.selectedDateRange).toBe(DateRanges.all);
    expect(hapticsService.selection).toHaveBeenCalledTimes(1);
  });

  it('should keep previous date range and skip search when all date range warning is cancelled', async () => {
    const dialog = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of(false),
      }),
    };
    const { component, hapticsService } = createComponent(dialog);
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
    expect(hapticsService.selection).toHaveBeenCalledTimes(1);
  });

  it('should keep custom start/end dates when all date range warning is cancelled', async () => {
    const dialog = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of(false),
      }),
    };
    const { component, hapticsService } = createComponent(dialog);
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
    expect(hapticsService.selection).toHaveBeenCalledTimes(1);
  });
});
