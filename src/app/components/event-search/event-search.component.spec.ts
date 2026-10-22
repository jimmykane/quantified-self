import { AppEventColorService } from '../../services/color/app.event.color.service';
import { By } from '@angular/platform-browser';
import { OverlayContainer } from '@angular/cdk/overlay';
import { DateAdapter } from '@angular/material/core';
import { MatDateRangeInput, MatDateRangePicker } from '@angular/material/datepicker';
import type { Dayjs } from 'dayjs';
import { MatSelect } from '@angular/material/select';
import dayjs from 'dayjs';
import { ActivityFilterPickerComponent } from '../shared/activity-filter-picker/activity-filter-picker.component';
import { MergedActivitiesToggleComponent } from '../shared/merged-activities-toggle/merged-activities-toggle.component';
import { ChangeDetectorRef, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActivityTypes, DateRanges, DaysOfTheWeek } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { getDatesForDateRange } from '../../helpers/date-range-helper';
import { EventSearchComponent, Search } from './event-search.component';
import { ActivityTypesMultiSelectComponent } from '../activity-types-multi-select/activity-types-multi-select.component';
import { MaterialModule } from '../../modules/material.module';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { AppHapticsService } from '../../services/app.haptics.service';

@Component({
  selector: 'app-merged-filter-test-host',
  standalone: false,
  template: `<app-event-search class="table-toolbar-layout compact-filter-layout"
    [compact]="true" [toolbarRangeLayout]="toolbar" [selectedDateRange]="range"
    [startOfTheWeek]="weekStart" [selectedActivityTypes]="sports" [availableActivityTypes]="availableSports" [showMergedEventsToggle]="true"
    [includeMergedEvents]="includeMerged" [mergedEventsToggleDisabled]="disabled"
    (searchChange)="onSearch($event)"></app-event-search>`,
})
class MergedFilterTestHost {
  toolbar = true;
  sports: ActivityTypes[] | null | undefined = [];
  availableSports?: ActivityTypes[];
  range = DateRanges.thisWeek;
  weekStart = DaysOfTheWeek.Monday;
  includeMerged = true;
  disabled = false;
  acceptSearch = false;
  requests: Search[] = [];

  onSearch(search: Search): void {
    this.requests.push(search);
    if (this.acceptSearch) {
      this.includeMerged = search.includeMergedEvents !== false;
    }
  }
}

describe('Merged toolbar filter rendering', () => {
  const haptics = { selection: vi.fn() };

  beforeEach(async () => {
    haptics.selection.mockClear();
    await TestBed.configureTestingModule({
      declarations: [MergedFilterTestHost, EventSearchComponent, ActivityTypesMultiSelectComponent],
      imports: [ActivityFilterPickerComponent, MergedActivitiesToggleComponent, CommonModule, ReactiveFormsModule, NoopAnimationsModule, MaterialModule, AppChartSharedModule],
      providers: [{ provide: AppHapticsService, useValue: haptics },
        { provide: AppEventColorService, useValue: { getColorForActivityTypeByActivityTypeGroup: () => '#123456' } }],
    }).compileComponents();
  });

  it('keeps the merged checkmark aligned when the parent rejects a filter change', async () => {
    const fixture = TestBed.createComponent(MergedFilterTestHost);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('.merged-events-button') as HTMLButtonElement;

    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.requests).toEqual([
      expect.objectContaining({ includeMergedEvents: false }),
    ]);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toContain('check_box');
    expect(button.textContent).not.toContain('check_box_outline_blank');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  it('replaces presets in place, applies native calendar selections once and restores focus on clear', async () => {
    const fixture = TestBed.createComponent(MergedFilterTestHost);
    fixture.componentInstance.range = DateRanges.thisMonth;
    fixture.detectChanges();
    const render = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    const selector = fixture.debugElement.query(By.directive(MatSelect)).componentInstance as MatSelect;
    selector.open(); await render();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    (Array.from(overlay.querySelectorAll('mat-option')).find(option => option.textContent?.trim() === 'Custom dates') as HTMLElement).click();
    await render();
    const search = fixture.debugElement.query(By.directive(EventSearchComponent)).componentInstance as EventSearchComponent;
    const presetEnd = getDatesForDateRange(DateRanges.thisMonth, DaysOfTheWeek.Monday).endDate!;
    expect(search.endDateControl.value?.getTime()).toBe(presetEnd.getTime() - 1);
    expect(fixture.nativeElement.querySelector('mat-select[aria-label="Date range"]')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Start date');
    search.searchFormGroup.patchValue({ startDate: null, endDate: null });
    const picker = fixture.debugElement.query(By.directive(MatDateRangePicker)).componentInstance as MatDateRangePicker<Dayjs>;
    const adapter = fixture.debugElement.query(By.directive(MatDateRangeInput)).injector.get(DateAdapter) as DateAdapter<Dayjs>;
    picker.startAt = dayjs('2026-09-01');
    fixture.nativeElement.querySelector('input[aria-label="Start date"]').click(); await render();
    for (const date of ['2026-09-03', '2026-09-04']) {
      const label = adapter.format(dayjs(date), 'LL');
      const cell = Array.from(overlay.querySelectorAll<HTMLElement>('[aria-label]')).find(element => element.getAttribute('aria-label') === label);
      expect(cell).toBeDefined(); cell!.click(); await render();
      expect(fixture.componentInstance.requests).toEqual([]);
    }
    (overlay.querySelector('button[matDateRangePickerApply]') as HTMLButtonElement).click(); await render();
    expect(fixture.componentInstance.requests).toHaveLength(1);
    expect(fixture.componentInstance.requests[0]).toMatchObject({
      dateRange: DateRanges.custom, startDate: new Date(2026, 8, 3), endDate: new Date(2026, 8, 4, 23, 59, 59, 999),
    });
    expect(haptics.selection).toHaveBeenCalledTimes(3);
    fixture.nativeElement.querySelector('button[aria-label="Clear custom dates and show date presets"]').click(); await render();
    expect(fixture.componentInstance.requests).toHaveLength(2);
    expect(fixture.componentInstance.requests[1].dateRange).toBe(DateRanges.lastThirtyDays);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Date range');
  });

  it('uses the same sport picker in the My Tracks layout and preserves available and selected no-match sports', async () => {
    const fixture = TestBed.createComponent(MergedFilterTestHost);
    const host = fixture.componentInstance; host.toolbar = false;
    host.sports = [ActivityTypes.Running]; host.availableSports = [ActivityTypes.Cycling];
    const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    await settle();
    const trigger = fixture.nativeElement.querySelector('input[aria-label="Sports"]') as HTMLInputElement;
    expect(trigger).toBeTruthy(); trigger.click(); await settle();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    expect([...overlay.querySelectorAll('mat-list-option')].map(option => option.getAttribute('aria-label'))).toEqual(['Cycling', 'Running']);
    expect(host.requests).toEqual([]); expect(haptics.selection).toHaveBeenCalledOnce();
    (overlay.querySelector('[aria-label="Cycling"]') as HTMLElement).click(); await settle();
    expect(host.requests).toEqual([expect.objectContaining({ activityTypes: [ActivityTypes.Running, ActivityTypes.Cycling], dateRange: DateRanges.thisWeek })]);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    [...overlay.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Done')!.click(); await settle();
    expect(host.requests).toHaveLength(1);
  });

  it.each([undefined, null])('handles a missing My Tracks sport filter (%s) and later hydration without searching', async savedSports => {
    const fixture = TestBed.createComponent(MergedFilterTestHost);
    const host = fixture.componentInstance;
    host.toolbar = false; host.sports = savedSports; host.availableSports = [ActivityTypes.Cycling];
    const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    await settle();
    const trigger = fixture.nativeElement.querySelector('input[aria-label="Sports"]') as HTMLInputElement;
    expect(trigger.value).toBe('All sports');
    expect(host.requests).toEqual([]); expect(haptics.selection).not.toHaveBeenCalled();
    trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await settle();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    host.sports = [ActivityTypes.Running]; await settle();
    expect(trigger.value).toBe('Running');
    expect(overlay.querySelector('[aria-label="Running"]')?.getAttribute('aria-selected')).toBe('true');
    host.sports = savedSports; await settle();
    expect(trigger.value).toBe('All sports');
    expect(overlay.querySelector('[aria-label="Running"]')).toBeNull();
    expect(host.requests).toEqual([]); expect(haptics.selection).toHaveBeenCalledOnce();
    const cycling = overlay.querySelector<HTMLElement>('mat-list-option[aria-label="Cycling"]')!;
    cycling.focus(); cycling.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', keyCode: 32, bubbles: true })); await settle();
    expect(host.requests).toEqual([expect.objectContaining({ activityTypes: [ActivityTypes.Cycling] })]);
    expect(trigger.value).toBe('Cycling'); expect(haptics.selection).toHaveBeenCalledTimes(2);
    [...overlay.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Done')!.click(); await settle();
    expect(document.activeElement).toBe(trigger);
  });

  it('follows parent preferences silently and accepts one action after being enabled', async () => {
    const fixture = TestBed.createComponent(MergedFilterTestHost);
    fixture.detectChanges();
    const host = fixture.componentInstance;
    const button = fixture.nativeElement.querySelector('.merged-events-button') as HTMLButtonElement;

    host.includeMerged = false;
    host.disabled = true;
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.disabled).toBe(true);
    button.click();
    expect(host.requests).toEqual([]);
    expect(haptics.selection).not.toHaveBeenCalled();

    host.disabled = false;
    host.acceptSearch = true;
    fixture.detectChanges();
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.requests).toEqual([expect.objectContaining({ includeMergedEvents: true })]);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });
});

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

  it('accepts activity filter changes without duplicating the selector feedback', async () => {
    const { component, hapticsService } = createComponent();
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);
    const activityTypes = [ActivityTypes.Running];

    await component.onActivityTypesChange(activityTypes);

    expect(component.selectedActivityTypes).toEqual(activityTypes);
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(hapticsService.selection).not.toHaveBeenCalled();
  });

  it('offers full date preset labels, with Custom dates and All dates last', () => {
    const { component } = createComponent(undefined, c => { c.toolbarRangeLayout = true; c.compact = true; });
    expect(component.toolbarDateRangeOptions[0].label).toBe('Last 30 days');
    expect(component.toolbarDateRangeOptions.slice(-2).map(option => option.label)).toEqual(['Custom dates', 'All dates']);
  });

  it('uses activity language for merged rows and long-range loading', () => {
    const { component } = createComponent();

    expect(component.mergedEventsToggleLabel).toBe('Merged activities');
    expect(component.mergedEventsToggleHint).toBe('Merged activities are excluded');
  });

  it('uses wrapping field controls for the table toolbar', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/event-search/event-search.component.scss'),
      'utf8',
    );

    expect(styles).toContain(':host(.table-toolbar-layout) .toolbar-controls');
    expect(styles).toContain('flex-wrap: wrap;');
    expect(styles).not.toContain('.toolbar-range-group');
  });

  it('cancels All dates from the preset selector without querying or changing the displayed range', async () => {
    const dialog = { open: vi.fn().mockReturnValue({ afterClosed: () => of(false) }) };
    const { component } = createComponent(dialog, c => { c.toolbarRangeLayout = true; });
    const source = { value: DateRanges.all } as MatSelect;
    const search = vi.spyOn(component, 'search');
    await component.onToolbarDateRangeChange(DateRanges.all, source);
    expect(dialog.open).toHaveBeenCalledOnce();
    expect(search).not.toHaveBeenCalled();
    expect(source.value).toBe(DateRanges.thisWeek);
    expect(component.selectedDateRange).toBe(DateRanges.thisWeek);
  });

  it('edits custom dates in place and only searches on valid Apply or clearing an applied range', async () => {
    const { component, hapticsService } = createComponent();
    const emit = vi.spyOn(component.searchChange, 'emit');
    await component.onToolbarDateRangeChange(DateRanges.custom);
    expect(component.customRangeOpen).toBe(true);
    expect(component.selectedDateRange).toBe(DateRanges.thisWeek);
    component.startDateControl.setValue(dayjs('2026-09-01'));
    component.endDateControl.setValue(dayjs('2026-09-03'));
    expect(emit).not.toHaveBeenCalled();
    await component.applyToolbarCustomRange();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(component.selectedStartDate?.getHours()).toBe(0);
    expect(component.selectedEndDate?.getHours()).toBe(23);
    expect(component.selectedEndDate?.getDate()).toBe(3);
    await component.applyToolbarCustomRange();
    expect(emit).toHaveBeenCalledTimes(1);
    component.startDateControl.setValue(null);
    await component.applyToolbarCustomRange();
    expect(emit).toHaveBeenCalledTimes(1);
    component.cancelToolbarCustomRange();
    expect(component.startDateControl.value?.getTime()).toBe(component.selectedStartDate?.getTime());
    await component.clearToolbarCustomRange();
    expect(component.selectedDateRange).toBe(DateRanges.lastThirtyDays);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(hapticsService.selection).toHaveBeenCalledTimes(4);
  });

  it('cancels an unapplied custom editor without querying and accepts only changed sport checkboxes', async () => {
    const { component, hapticsService } = createComponent();
    const search = vi.spyOn(component, 'search').mockResolvedValue(undefined);
    await component.onToolbarDateRangeChange(DateRanges.custom);
    await component.clearToolbarCustomRange();
    expect(component.selectedDateRange).toBe(DateRanges.thisWeek);
    expect(component.customRangeOpen).toBe(false);
    expect(search).not.toHaveBeenCalled();
    hapticsService.selection.mockClear();
    await component.onToolbarSportsChange(['Running', 'Cycling']);
    expect(component.toolbarSelectedSports).toEqual(['Running', 'Cycling']);
    await component.onToolbarSportsChange(['Cycling', 'Run']);
    expect(search).toHaveBeenCalledTimes(1);
    expect(hapticsService.selection).toHaveBeenCalledTimes(1);
    expect(component.toolbarDateRangeOptions.at(-1)?.label).toBe('All dates');
  });

  it('keeps draft dates out of sport and merged filter requests', async () => {
    const { component } = createComponent(undefined, c => { c.toolbarRangeLayout = true; });
    const emit = vi.spyOn(component.searchChange, 'emit');
    const committed = getDatesForDateRange(DateRanges.thisWeek, DaysOfTheWeek.Monday);
    await component.onToolbarDateRangeChange(DateRanges.custom);
    component.startDateControl.setValue(dayjs('2020-01-01'));
    component.endDateControl.setValue(null);
    await component.onToolbarSportsChange(['Running']);
    await component.onMergedEventsChange(false);
    expect(emit).toHaveBeenCalledTimes(2);
    for (const [request] of emit.mock.calls) {
      expect(request.dateRange).toBe(DateRanges.thisWeek);
      expect(request.startDate?.getTime()).toBe(committed.startDate?.getTime());
      expect(request.endDate?.getTime()).toBe(committed.endDate?.getTime());
    }
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

  it('requests merged activities without overwriting the parent-owned filter', async () => {
    const { component, hapticsService } = createComponent();
    component.includeMergedEvents = false;
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);
    const event = {
      value: ['merged'],
    } as any;

    await component.onMergedEventsToggleChange(event);

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalledWith(true);
    expect(component.includeMergedEvents).toBe(false);
    expect(hapticsService.selection).toHaveBeenCalledTimes(1);
  });

  it('toggles merged activities through the toolbar button without changing the date range', async () => {
    const { component, hapticsService } = createComponent(undefined, searchComponent => {
      searchComponent.compact = true;
      searchComponent.toolbarRangeLayout = true;
    });
    const emitSpy = vi.spyOn(component.searchChange, 'emit');
    const initialRange = component.selectedDateRange;

    await component.onMergedEventsChange(false);
    expect(emitSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      includeMergedEvents: false,
      dateRange: initialRange,
    }));

    // Acknowledge the requested value as the parent does after accepting a search.
    component.includeMergedEvents = false;
    await component.onMergedEventsChange(true);
    expect(emitSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      includeMergedEvents: true,
      dateRange: initialRange,
    }));
    expect(emitSpy).toHaveBeenCalledTimes(2);
    expect(hapticsService.selection).toHaveBeenCalledTimes(2);
  });

  it('does not repeat search or haptics for an unchanged merged filter', async () => {
    const { component, hapticsService } = createComponent();
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);

    await component.onMergedEventsChange(true);

    expect(searchSpy).not.toHaveBeenCalled();
    expect(hapticsService.selection).not.toHaveBeenCalled();
  });

  it('does not toggle a disabled merged toolbar button', async () => {
    const { component, hapticsService } = createComponent();
    component.mergedEventsToggleDisabled = true;
    const searchSpy = vi.spyOn(component, 'search').mockResolvedValue(undefined);

    await component.onMergedEventsChange(false);

    expect(component.includeMergedEvents).toBe(true);
    expect(searchSpy).not.toHaveBeenCalled();
    expect(hapticsService.selection).not.toHaveBeenCalled();
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
    expect(dialog.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({
        title: 'Load all activities?',
        message: expect.stringContaining('every activity'),
      }),
    }));
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
