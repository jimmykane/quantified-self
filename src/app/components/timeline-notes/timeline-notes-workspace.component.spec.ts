import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineNotesWorkspaceComponent } from './timeline-notes-workspace.component';
import { AppTimelineNotesService } from '../../services/app.timeline-notes.service';
import { AppHapticsService } from '../../services/app.haptics.service';

describe('Timeline notes workspace ownership', () => {
  const note = { id: 'a'.repeat(64), category: 'other' as const, title: 'Private', startDate: '2026-01-02', endDate: '2026-01-02', timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
  const service = { uid: signal<string | null>('owner'), showOnCharts: signal(true), changes$: new Subject<void>(), loadRange: vi.fn(), invalidate: vi.fn(), isOwner: (uid: string) => service.uid() === uid };
  const dialogs = { open: vi.fn() };
  const haptics = { selection: vi.fn() };
  let component: TimelineNotesWorkspaceComponent;
  const flush = async () => { TestBed.flushEffects(); await Promise.resolve(); await Promise.resolve(); };
  beforeEach(() => {
    vi.clearAllMocks(); service.uid.set('owner'); service.showOnCharts.set(true); service.loadRange.mockResolvedValue({ notes: [note], incomplete: null });
    service.invalidate.mockImplementation(() => service.changes$.next());
    TestBed.configureTestingModule({ providers: [{ provide: AppTimelineNotesService, useValue: service }, { provide: MatDialog, useValue: dialogs }, { provide: AppHapticsService, useValue: haptics }] });
    component = TestBed.runInInjectionContext(() => new TimelineNotesWorkspaceComponent());
  });
  it('provides tap feedback for management and retry, not background refreshes or disabled controls', async () => {
    const fixture = TestBed.createComponent(TimelineNotesWorkspaceComponent);
    fixture.detectChanges(); await fixture.whenStable();
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('button').click();
    expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.componentInstance.refresh();
    expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.componentInstance.error.set(true); fixture.detectChanges();
    fixture.nativeElement.querySelectorAll('button')[1].click();
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    service.uid.set(null); fixture.detectChanges();
    fixture.nativeElement.querySelector('button').click();
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('coalesces chart ranges into one request and exposes keyboard-accessible management', async () => {
    component.context().reportRange({}, { startDate: '2026-01-01', endDate: '2026-01-10' });
    component.context().reportRange({}, { startDate: '2025-12-01', endDate: '2026-01-04' });
    await flush();
    expect(service.loadRange).toHaveBeenCalledTimes(1);
    expect(service.loadRange).toHaveBeenCalledWith('owner', { startDate: '2025-12-01', endDate: '2026-01-10' });
    expect(component.context().notes).toEqual([note]);
    component.context().select([note]); expect(dialogs.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: { uid: 'owner', notes: [note] } }));
  });
  it('keeps fixed Highlights windows loaded alongside an older explorer and releases them on removal', async () => {
    const heartRate = {}, hrv = {}, explorer = {};
    const report = component.context().reportRange;
    report(heartRate, { startDate: '2025-12-12', endDate: '2026-01-10' });
    report(hrv, { startDate: '2025-12-28', endDate: '2026-01-10' });
    report(explorer, { startDate: '2025-11-01', endDate: '2025-11-30' });
    await flush();
    expect(service.loadRange).toHaveBeenCalledExactlyOnceWith('owner', { startDate: '2025-11-01', endDate: '2026-01-10' });
    expect(component.context().notes).toEqual([note]);
    report(heartRate, null); report(hrv, null);
    await flush();
    expect(service.loadRange).toHaveBeenLastCalledWith('owner', { startDate: '2025-11-01', endDate: '2025-11-30' });
  });
  it('loads an explicit calendar range, refreshes navigation, and honors the global visibility preference', async () => {
    const fixture = TestBed.createComponent(TimelineNotesWorkspaceComponent);
    fixture.componentRef.setInput('visibleRange', { startDate: '2026-01-01', endDate: '2026-01-31' });
    fixture.detectChanges(); await fixture.whenStable(); await flush();
    expect(service.loadRange).toHaveBeenLastCalledWith('owner', { startDate: '2026-01-01', endDate: '2026-01-31' });
    fixture.componentRef.setInput('visibleRange', { startDate: '2026-02-01', endDate: '2026-02-28' });
    fixture.detectChanges(); await fixture.whenStable(); await flush();
    expect(service.loadRange).toHaveBeenLastCalledWith('owner', { startDate: '2026-02-01', endDate: '2026-02-28' });
    service.showOnCharts.set(false); await flush();
    expect(fixture.componentInstance.context().notes).toEqual([]);
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('provides one feedback for an accepted note marker, not empty or stale-account selections', async () => {
    await flush();
    const context = component.context();
    expect(haptics.selection).not.toHaveBeenCalled();
    context.select([]);
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    context.select([note]);
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(dialogs.open).toHaveBeenCalledOnce();
    service.uid.set('another-owner'); await flush();
    context.select([note]);
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(dialogs.open).toHaveBeenCalledOnce();
  });
  it('ignores stale ranges and clears private state on account switch', async () => {
    let resolve!: (value: unknown) => void;
    service.loadRange.mockReturnValueOnce(new Promise(value => { resolve = value; }));
    const oldContext = component.context();
    const key = {}; component.context().reportRange(key, { startDate: '2026-01-01', endDate: '2026-01-10' }); await flush();
    service.uid.set(null); await flush(); resolve({ notes: [note], incomplete: null }); await flush();
    expect(component.context().notes).toEqual([]); expect(component.loading()).toBe(false);
    component.open(); expect(dialogs.open).not.toHaveBeenCalled();
    service.uid.set('another-owner'); await flush(); oldContext.select([note]);
    expect(dialogs.open).not.toHaveBeenCalled();
  });
  it('does not fetch hidden notes and recovers independently from metric charts', async () => {
    service.showOnCharts.set(false); component.context().reportRange({}, { startDate: '2026-01-01', endDate: '2026-01-10' }); await flush();
    expect(service.loadRange).not.toHaveBeenCalled();
    service.loadRange.mockRejectedValueOnce(new Error('offline')); service.showOnCharts.set(true); await flush();
    expect(component.error()).toBe(true); expect(component.context().notes).toEqual([]);
    service.loadRange.mockResolvedValueOnce({ notes: [note], incomplete: 'records' }); component.refresh(); await flush();
    expect(component.incomplete()).toBe('records'); expect(component.error()).toBe(false);
  });
});
