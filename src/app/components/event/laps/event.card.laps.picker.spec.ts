import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MAT_ICON_DEFAULT_OPTIONS, MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatTableModule } from '@angular/material/table';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DataDuration, DataDistance, DataPaceAvg, DataSpeedMin, LapTypes, type ActivityInterface, type LapInterface } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { EventCardLapsComponent } from './event.card.laps.component';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { normalizeEventDetailsSettings } from '../../../helpers/event-lap-table-columns.helper';

async function setupPicker(order = [DataDuration.type, DataDistance.type, DataPaceAvg.type], multisport = false) {
  const settings = signal(normalizeEventDetailsSettings({ lapTableColumnsBySportFamily: { running: order } }));
  const save = vi.fn().mockResolvedValue(undefined);
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  await TestBed.configureTestingModule({
    imports: [CommonModule, NoopAnimationsModule, MatButtonModule, MatCheckboxModule, MatDialogModule,
      MatFormFieldModule, MatIconModule, MatInputModule, MatListModule, MatSelectModule, MatTableModule],
    declarations: [EventCardLapsComponent],
    providers: [
      { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
      { provide: AppUserSettingsQueryService, useValue: { eventDetailsSettings: settings, updateLapTableColumns: save } },
      { provide: AppHapticsService, useValue: haptics },
      { provide: AppEventColorService, useValue: {} },
      { provide: MatSnackBar, useValue: { open: vi.fn() } },
    ],
    schemas: [NO_ERRORS_SCHEMA],
  }).compileComponents();
  const fixture = TestBed.createComponent(EventCardLapsComponent);
  const activity = {
    type: 'Running', getID: () => 'running',
    getLaps: () => [{ type: LapTypes.Manual, getDuration: () => new DataDuration(60),
      getDistance: () => new DataDistance(250), getStat: () => undefined } as unknown as LapInterface],
  } as ActivityInterface;
  fixture.componentRef.setInput('selectedActivities', multisport
    ? [activity, ...['Cycling', 'Swimming', 'Hiking'].map(type => ({ ...activity, type, getID: () => type } as ActivityInterface))]
    : [activity]);
  fixture.componentRef.setInput('canCustomize', true);
  fixture.detectChanges();
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const trigger = fixture.nativeElement.querySelector('button[aria-label="Choose lap columns"]') as HTMLButtonElement;
  trigger.focus();
  trigger.click();
  await settle();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  const selected = () => Array.from(dialog.querySelectorAll<HTMLElement>('[data-lap-column]')).map(row => row.dataset.lapColumn);
  return { fixture, component: fixture.componentInstance, dialog, trigger, save, settings, haptics, selected, settle };
}

describe('lap column picker Material interactions', () => {
  it('switches among four sport families through the real Material select without saving a layout', async () => {
    const picker = await setupPicker(undefined, true);
    const select = picker.dialog.querySelector<HTMLElement>('mat-select[aria-label="Lap sport family"]')!;
    select.click();
    await picker.settle();
    const other = Array.from(document.querySelectorAll<HTMLElement>('mat-option'))
      .find(option => option.textContent?.trim() === 'Other activities')!;
    other.click();
    await picker.settle();
    expect(select.textContent).toContain('Other activities');
    expect(picker.component.activeLapColumnMenuGroup?.family).toBe('other');
    expect(picker.dialog.textContent).toContain('Choose columns for other activities laps');
    expect(picker.save).not.toHaveBeenCalled();
    expect(picker.haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('shows the exact saved selection first, including unavailable metrics, without writes on open', async () => {
    const picker = await setupPicker([DataPaceAvg.type, DataDuration.type, DataDistance.type]);
    expect(picker.dialog.getAttribute('aria-label')).toBe('Choose lap columns');
    expect(picker.selected()).toEqual([DataPaceAvg.type, DataDuration.type, DataDistance.type]);
    expect(picker.dialog.textContent).toContain('No data in current laps');
    expect(picker.dialog.querySelector('button[aria-label="Move Average Pace up"]')?.hasAttribute('disabled')).toBe(true);
    expect(picker.dialog.querySelector('button[aria-label="Move Distance down"]')?.hasAttribute('disabled')).toBe(true);
    expect(picker.dialog.querySelector('mat-list-option button')).toBeNull();
    expect(picker.save).not.toHaveBeenCalled();
    expect(picker.haptics.selection).toHaveBeenCalledTimes(1);
  });

  it('adds a searched metric with Space and keeps focus in the picker when the option moves', async () => {
    const picker = await setupPicker();
    const search = picker.dialog.querySelector<HTMLInputElement>('input[data-lap-column-search]')!;
    search.value = 'min speed';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await picker.settle();
    expect(picker.haptics.selection).toHaveBeenCalledTimes(1);
    const option = Array.from(picker.dialog.querySelectorAll<HTMLElement>('mat-list-option'))
      .find(element => element.textContent?.trim() === 'Minimum')!;
    option.focus();
    option.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true }));
    await picker.settle();
    expect(picker.save).toHaveBeenCalledWith('running', [DataDuration.type, DataDistance.type, DataPaceAvg.type, DataSpeedMin.type]);
    expect(picker.selected()).toEqual([DataDuration.type, DataDistance.type, DataPaceAvg.type, DataSpeedMin.type]);
    expect(document.activeElement?.closest('[data-lap-column]')?.getAttribute('data-lap-column')).toBe(DataSpeedMin.type);
    expect(picker.haptics.selection).toHaveBeenCalledTimes(2);
    expect(picker.haptics.success).toHaveBeenCalledTimes(1);
  });

  it('moves through native buttons, restores focus at the boundary and announces the saved position', async () => {
    const picker = await setupPicker([DataDuration.type, DataPaceAvg.type]);
    const move = picker.dialog.querySelector<HTMLButtonElement>('button[aria-label="Move Average Pace up"]')!;
    move.focus();
    move.click();
    await picker.settle();
    expect(picker.selected()).toEqual([DataPaceAvg.type, DataDuration.type]);
    expect(picker.save).toHaveBeenCalledWith('running', [DataPaceAvg.type, DataDuration.type]);
    expect(move.disabled).toBe(true);
    expect(document.activeElement?.closest('[data-lap-column]')?.getAttribute('data-lap-column')).toBe(DataPaceAvg.type);
    expect(picker.dialog.textContent).toContain('Average Pace moved to position 1 of 2');
    picker.dialog.querySelector<HTMLButtonElement>('[mat-dialog-close]')!.click();
    await picker.settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(picker.trigger);
    expect(picker.haptics.selection).toHaveBeenCalledTimes(3);
  });

  it('keeps keyboard focus inside the dialog while an added option is saving', async () => {
    const picker = await setupPicker();
    let finish!: () => void;
    picker.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const search = picker.dialog.querySelector<HTMLInputElement>('[data-lap-column-search]')!;
    search.value = 'min speed';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await picker.settle();
    const option = picker.dialog.querySelector<HTMLElement>('mat-list-option')!;
    option.focus();
    option.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true }));
    await picker.settle();
    expect(picker.dialog.textContent).toContain('Saving columns');
    expect(picker.dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(search);
    finish();
    await picker.settle();
    expect(document.activeElement).toBe(search);
    expect(picker.haptics.success).toHaveBeenCalledTimes(1);
  });

  it('returns keyboard focus to search when its clear button disappears', async () => {
    const picker = await setupPicker();
    const search = picker.dialog.querySelector<HTMLInputElement>('[data-lap-column-search]')!;
    search.value = 'speed';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await picker.settle();
    const clear = picker.dialog.querySelector<HTMLButtonElement>('button[aria-label="Clear metric search"]')!;
    clear.focus();
    clear.click();
    await picker.settle();
    expect(search.value).toBe('');
    expect(document.activeElement).toBe(search);
    expect(picker.save).not.toHaveBeenCalled();
    expect(picker.haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('disables pending changes and rolls the selected list back after a failed move', async () => {
    const picker = await setupPicker([DataDuration.type, DataPaceAvg.type]);
    let reject!: (error: Error) => void;
    picker.save.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const move = picker.dialog.querySelector<HTMLButtonElement>('button[aria-label="Move Average Pace up"]')!;
    move.focus();
    move.click();
    picker.fixture.detectChanges();
    expect(picker.dialog.textContent).toContain('Saving columns');
    expect(Array.from(picker.dialog.querySelectorAll<HTMLInputElement>('.lap-column-selected-list input')).every(input => input.disabled)).toBe(true);
    expect(picker.haptics.success).not.toHaveBeenCalled();
    reject(new Error('offline'));
    await picker.settle();
    expect(picker.selected()).toEqual([DataDuration.type, DataPaceAvg.type]);
    expect(move.disabled).toBe(false);
    expect(document.activeElement).toBe(move);
    expect(picker.haptics.error).toHaveBeenCalledTimes(1);
    expect(picker.dialog.textContent).toContain('Your previous columns have been restored');
  });

  it('removes the last selected column through its checkbox without losing keyboard focus', async () => {
    const picker = await setupPicker([DataDuration.type]);
    const checkbox = picker.dialog.querySelector<HTMLInputElement>('.lap-column-selected-list input')!;
    checkbox.focus();
    checkbox.click();
    await picker.settle();
    expect(picker.save).toHaveBeenCalledWith('running', []);
    expect(picker.selected()).toEqual([]);
    expect(picker.dialog.textContent).toContain('No columns selected');
    expect(document.activeElement).toBe(picker.dialog.querySelector('[data-lap-column-search]'));
    expect(picker.haptics.success).toHaveBeenCalledTimes(1);
  });

  it('does not reopen the dialog or steal focus when a pending move finishes after dismissal', async () => {
    const picker = await setupPicker([DataDuration.type, DataPaceAvg.type]);
    let finish!: () => void;
    picker.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const move = picker.dialog.querySelector<HTMLButtonElement>('button[aria-label="Move Average Pace up"]')!;
    move.focus();
    move.click();
    picker.fixture.detectChanges();
    picker.dialog.querySelector<HTMLButtonElement>('[mat-dialog-close]')!.click();
    await picker.settle();
    expect(document.activeElement).toBe(picker.trigger);
    finish();
    await picker.settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(picker.trigger);
    expect(picker.component.getColumnsToDisplay('Running')).toEqual(['#', DataPaceAvg.type, DataDuration.type]);
  });
});
