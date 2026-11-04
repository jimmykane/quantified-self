import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { OverlayContainer } from '@angular/cdk/overlay';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { DateAdapter } from '@angular/material/core';
import { MatDateRangePicker } from '@angular/material/datepicker';
import dayjs, { type Dayjs } from 'dayjs';
import { describe, expect, it, vi } from 'vitest';
import { MaterialModule } from '../../../modules/material.module';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { TableDateFilterComponent } from './table-date-filter.component';

async function setup() {
  const haptics = { selection: vi.fn() };
  TestBed.configureTestingModule({ imports: [TableDateFilterComponent, MaterialModule, NoopAnimationsModule], providers: [
    { provide: AppHapticsService, useValue: haptics },
  ] });
  const fixture = TestBed.createComponent(TableDateFilterComponent);
  const form = new FormGroup({ start: new FormControl<Dayjs | null>(null, Validators.required), end: new FormControl<Dayjs | null>(null, Validators.required) });
  fixture.componentRef.setInput('options', [{ value: 'month', label: 'Last 30 days' }, { value: 'week', label: 'Last 7 days' }, { value: 'custom', label: 'Custom dates' }, { value: 'all', label: 'All dates' }]);
  fixture.componentRef.setInput('value', 'month'); fixture.componentRef.setInput('customValue', 'custom'); fixture.componentRef.setInput('allValue', 'all');
  fixture.componentRef.setInput('rangeForm', form);
  const selected = vi.fn(); const applied = vi.fn(); const cancelled = vi.fn(); const cleared = vi.fn(); const opened = vi.fn();
  fixture.componentInstance.selectionChange.subscribe(selected); fixture.componentInstance.applied.subscribe(applied);
  fixture.componentInstance.cancelled.subscribe(cancelled); fixture.componentInstance.cleared.subscribe(cleared); fixture.componentInstance.calendarOpened.subscribe(opened);
  const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
  await settle();
  const overlay = TestBed.inject(OverlayContainer).getContainerElement();
  const trigger = fixture.nativeElement.querySelector('button[aria-label^="Date range:"]') as HTMLButtonElement;
  const chooseCustom = async () => {
    trigger.click(); await settle();
    [...overlay.querySelectorAll<HTMLButtonElement>('button[role="menuitemradio"]')].find(button => button.textContent?.includes('Custom dates'))!.click();
    await settle();
  };
  return { fixture, form, haptics, selected, applied, cancelled, cleared, opened, trigger, overlay, settle, chooseCustom };
}

describe('TableDateFilterComponent', () => {
  it('opens chart-style presets without changing the range, marks the selection and keeps All dates last with a warning', async () => {
    const c = await setup(); expect(c.haptics.selection).not.toHaveBeenCalled();
    expect(c.trigger.textContent).toContain('Last 30 days'); expect(c.fixture.nativeElement.querySelector('mat-form-field')).toBeNull();
    c.fixture.componentInstance.open(); await c.settle(); c.fixture.componentInstance.open();
    expect(c.haptics.selection).toHaveBeenCalledOnce(); expect(c.selected).not.toHaveBeenCalled();
    const choices = [...c.overlay.querySelectorAll<HTMLButtonElement>('button[role="menuitemradio"]')];
    expect(choices[0].getAttribute('aria-checked')).toBe('true');
    expect(choices.at(-1)?.textContent).toContain('All dates'); expect(choices.at(-1)?.textContent).toContain('May load a large history');
    choices[1].click(); await c.settle(); expect(c.selected).toHaveBeenCalledExactlyOnceWith('week');
    expect(c.applied).not.toHaveBeenCalled(); expect(c.haptics.selection).toHaveBeenCalledOnce();
  });

  it.each(['disable', 'destroy'])('discards a queued preset when the owner chooses to %s before the menu handoff', async action => {
    const c = await setup();
    c.trigger.click(); await c.settle();
    const week = [...c.overlay.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(button => button.textContent?.includes('Last 7 days'))!;
    week.click();
    expect(c.selected).not.toHaveBeenCalled();
    if (action === 'destroy') c.fixture.destroy();
    else c.fixture.componentRef.setInput('disabled', true);
    await c.settle();
    expect(c.selected).not.toHaveBeenCalled();
    expect(c.opened).not.toHaveBeenCalled();
  });

  it('uses the native range calendar, stages both dates until Apply and restores the date button focus', async () => {
    const c = await setup();
    const picker = c.fixture.debugElement.query(By.directive(MatDateRangePicker)).componentInstance as MatDateRangePicker<Dayjs>;
    picker.startAt = dayjs('2026-09-01');
    await c.chooseCustom();
    expect(c.selected).toHaveBeenCalledExactlyOnceWith('custom'); expect(c.opened).toHaveBeenCalledOnce();
    expect(c.overlay.querySelector('mat-calendar')).toBeTruthy(); expect(picker.touchUi).toBe(true);
    const adapter = TestBed.inject(DateAdapter) as DateAdapter<Dayjs>;
    for (const date of ['2026-09-03', '2026-09-04']) {
      const label = adapter.format(dayjs(date), 'LL');
      [...c.overlay.querySelectorAll<HTMLElement>('[aria-label]')].find(element => element.getAttribute('aria-label') === label)!.click(); await c.settle();
      expect(c.form.controls.start.value).toBeNull(); expect(c.applied).not.toHaveBeenCalled();
    }
    c.overlay.querySelector<HTMLButtonElement>('button[matDateRangePickerApply]')!.click(); await c.settle();
    expect(c.form.controls.start.value?.format('YYYY-MM-DD')).toBe('2026-09-03');
    expect(c.form.controls.end.value?.format('YYYY-MM-DD')).toBe('2026-09-04'); expect(c.applied).toHaveBeenCalledOnce();
    expect(c.cancelled).not.toHaveBeenCalled(); expect(document.activeElement).toBe(c.trigger);
  });

  it('shows applied dates with a separate clear action and cancels without applying draft changes', async () => {
    const c = await setup();
    c.fixture.componentRef.setInput('value', 'custom'); c.fixture.componentRef.setInput('startDate', '2026-10-01'); c.fixture.componentRef.setInput('endDate', '2026-10-29');
    c.form.setValue({ start: dayjs('2026-10-01'), end: dayjs('2026-10-29') }); await c.settle();
    expect(c.trigger.textContent).toContain('1–29 Oct 2026');
    await c.chooseCustom(); c.overlay.querySelector<HTMLButtonElement>('button[matDateRangePickerCancel]')!.click(); await c.settle();
    expect(c.cancelled).toHaveBeenCalledOnce(); expect(c.applied).not.toHaveBeenCalled(); expect(document.activeElement).toBe(c.trigger);
    (c.fixture.nativeElement.querySelector('button[aria-label="Clear custom dates and show date presets"]') as HTMLButtonElement).click(); await c.settle();
    expect(c.cleared).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(c.trigger);
  });

  it('ignores disabled actions and rejects an incomplete range without emitting Apply', async () => {
    const c = await setup(); c.fixture.componentRef.setInput('disabled', true); await c.settle();
    c.fixture.componentInstance.open(); c.fixture.componentInstance.clear(); c.fixture.componentInstance.choose('all');
    expect(c.trigger.disabled).toBe(true); expect(c.selected).not.toHaveBeenCalled(); expect(c.cleared).not.toHaveBeenCalled();
    expect(c.haptics.selection).not.toHaveBeenCalled();
    c.fixture.componentRef.setInput('disabled', false); await c.settle(); c.fixture.componentInstance.apply(); await c.settle();
    expect(c.applied).not.toHaveBeenCalled(); expect(c.fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('valid start and end dates');
  });
});
