import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimelineNote } from '@shared/timeline-notes';
import { ActiveSicknessNoteComponent } from './active-sickness-note.component';
import type { TimelineNoteChartContext } from '../../helpers/timeline-notes-chart.helper';

const note: TimelineNote = { id: 'a', category: 'sickness', title: 'Private', startDate: '2026-10-21', endDate: '2026-10-24',
  timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
let clockSpy: ReturnType<typeof vi.spyOn>;
let visibilitySpy: ReturnType<typeof vi.spyOn>;
afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); clockSpy?.mockRestore(); visibilitySpy?.mockRestore(); });
describe('Active sickness note', () => {
  it('renders one quiet Material action, registers today without charts and selects only current visible sickness notes', () => {
    clockSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 24, 12));
    const context: TimelineNoteChartContext = { ownerUid: 'owner', notes: [note, { ...note, id: 'hidden', showOnCharts: false }], reportRange: vi.fn(), select: vi.fn() };
    const fixture = TestBed.createComponent(ActiveSicknessNoteComponent);
    fixture.componentRef.setInput('context', context); fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.hasAttribute('mat-button')).toBe(true);
    expect(button.textContent).toContain('Sickness noted');
    expect(fixture.nativeElement.querySelector('mat-icon')).toBeNull();
    expect(context.reportRange).toHaveBeenCalledWith(fixture.componentInstance, { startDate: '2026-10-23', endDate: '2026-10-25' });
    expect(context.select).not.toHaveBeenCalled();
    button.click(); expect(context.select).toHaveBeenCalledExactlyOnceWith([note]);
    fixture.componentRef.setInput('context', null); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(context.reportRange).toHaveBeenLastCalledWith(fixture.componentInstance, null);
  });
  it('expires at the note timezone midnight and ignores a queued click on an ended note', () => {
    clockSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 24, 23, 59));
    const context: TimelineNoteChartContext = { ownerUid: 'owner', notes: [note], reportRange: vi.fn(), select: vi.fn() };
    const fixture = TestBed.createComponent(ActiveSicknessNoteComponent);
    fixture.componentRef.setInput('context', context); fixture.detectChanges();
    expect(fixture.componentInstance.hasActiveSickness()).toBe(true);
    clockSpy.mockReturnValue(Date.UTC(2026, 9, 25, 0, 1));
    fixture.componentInstance.open(); expect(context.select).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('focus')); fixture.detectChanges();
    expect(fixture.componentInstance.hasActiveSickness()).toBe(false);
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    fixture.destroy();
    expect(context.reportRange).toHaveBeenLastCalledWith(fixture.componentInstance, null);
  });
  it('never registers or renders notes without an explicit private owner', () => {
    const context: TimelineNoteChartContext = { notes: [note], reportRange: vi.fn(), select: vi.fn() };
    const fixture = TestBed.createComponent(ActiveSicknessNoteComponent);
    fixture.componentRef.setInput('context', context); fixture.detectChanges();
    fixture.componentInstance.open();
    expect(context.reportRange).not.toHaveBeenCalled(); expect(context.select).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });
  it('pauses its clock in hidden tabs, catches up on return and clears all timers on destruction', () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 9, 24, 23, 59));
    visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const fixture = TestBed.createComponent(ActiveSicknessNoteComponent);
    fixture.componentRef.setInput('context', { ownerUid: 'owner', notes: [note], reportRange: vi.fn(), select: vi.fn() });
    fixture.detectChanges();
    vi.advanceTimersByTime(0); // Settle Angular's one-shot render scheduler, not the minute clock.
    expect(vi.getTimerCount()).toBe(1);
    visibilitySpy.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(Date.UTC(2026, 9, 25, 0, 1));
    visibilitySpy.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange')); fixture.detectChanges();
    vi.advanceTimersByTime(0);
    expect(fixture.componentInstance.hasActiveSickness()).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    fixture.destroy(); vi.runOnlyPendingTimers();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not re-register reads, restart its clock or replace unchanged active notes on minute ticks or same-owner refreshes', () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 9, 24, 12));
    const setInterval = vi.spyOn(window, 'setInterval');
    const context: TimelineNoteChartContext = { ownerUid: 'owner', notes: [note], reportRange: vi.fn(), select: vi.fn() };
    const fixture = TestBed.createComponent(ActiveSicknessNoteComponent);
    fixture.componentRef.setInput('context', context); fixture.detectChanges(); vi.advanceTimersByTime(0);
    const active = fixture.componentInstance.activeNotes();
    vi.advanceTimersByTime(60_000); fixture.detectChanges();
    expect(fixture.componentInstance.activeNotes()).toBe(active);
    expect(context.reportRange).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('context', { ...context, notes: [note] }); fixture.detectChanges();
    expect(context.reportRange).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(context.select).not.toHaveBeenCalled();
    fixture.destroy(); setInterval.mockRestore();
  });
});
