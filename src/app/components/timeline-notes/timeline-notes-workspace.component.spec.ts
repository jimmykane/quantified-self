import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineNotesWorkspaceComponent } from './timeline-notes-workspace.component';
import { AppTimelineNotesService } from '../../services/app.timeline-notes.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  it('keeps existing chart annotations stable while a newly visible chart expands the union', async () => {
    const first = {}, second = {};
    const report = component.context().reportRange;
    report(first, { startDate: '2026-01-01', endDate: '2026-01-10' });
    await flush();
    const renderedContext = component.context();
    let resolveLoad!: (value: unknown) => void;
    service.loadRange.mockImplementationOnce(() => new Promise(resolve => { resolveLoad = resolve; }));
    report(second, { startDate: '2025-12-01', endDate: '2026-01-10' });
    await flush();
    expect(component.loading()).toBe(true);
    expect(component.context()).toBe(renderedContext);
    expect(component.context().notes).toEqual([note]);
    resolveLoad({ notes: [{ ...note }], incomplete: null });
    await flush();
    // A server/cache response with unchanged notes must not refresh every mounted chart again.
    expect(component.context()).toBe(renderedContext);
    expect(component.loading()).toBe(false);
    report(second, null); await flush();
    expect(component.context()).toBe(renderedContext);
  });

  it('replaces the expanded result atomically and retains known annotations if another range fails', async () => {
    const report = component.context().reportRange;
    report({}, { startDate: '2026-01-01', endDate: '2026-01-10' }); await flush();
    const olderNote = { ...note, id: 'b'.repeat(64), startDate: '2025-12-02', endDate: '2025-12-04' };
    let resolveLoad!: (value: unknown) => void;
    service.loadRange.mockImplementationOnce(() => new Promise(resolve => { resolveLoad = resolve; }));
    report({}, { startDate: '2025-12-01', endDate: '2026-01-10' }); await flush();
    expect(component.context().notes).toEqual([note]);
    resolveLoad({ notes: [olderNote, { ...note }], incomplete: 'records' }); await flush();
    expect(component.context().notes).toEqual([olderNote, note]);
    expect(component.incomplete()).toBe('records');
    const renderedContext = component.context();
    service.loadRange.mockRejectedValueOnce(new Error('offline'));
    report({}, { startDate: '2025-11-01', endDate: '2026-01-10' }); await flush();
    expect(component.error()).toBe(true);
    expect(component.context()).toBe(renderedContext);
    expect(component.incomplete()).toBe('records');
  });

  it('rejects out-of-order range loads while keeping the most recent visible snapshot', async () => {
    const report = component.context().reportRange;
    const key = {};
    report(key, { startDate: '2026-01-01', endDate: '2026-01-10' }); await flush();
    let resolveOlder!: (value: unknown) => void;
    service.loadRange.mockImplementationOnce(() => new Promise(resolve => { resolveOlder = resolve; }));
    report(key, { startDate: '2025-12-01', endDate: '2026-01-10' }); await flush();
    const updated = { ...note, revision: 2, title: 'Updated note', color: 'purple' as const };
    service.loadRange.mockResolvedValueOnce({ notes: [updated], incomplete: null });
    report(key, { startDate: '2025-11-01', endDate: '2026-01-10' }); await flush();
    expect(component.context().notes).toEqual([updated]);
    resolveOlder({ notes: [note], incomplete: 'records' }); await flush();
    expect(component.context().notes).toEqual([updated]);
    expect(component.incomplete()).toBeNull();
  });

  it.each(['account', 'profile', 'hidden', 'no ranges'] as const)(
    'clears retained annotations when %s changes during a range load', async change => {
      const fixture = TestBed.createComponent(TimelineNotesWorkspaceComponent);
      fixture.componentRef.setInput('ownerUid', 'owner'); fixture.detectChanges();
      const workspace = fixture.componentInstance;
      const key = {};
      const report = workspace.context().reportRange;
      report(key, { startDate: '2026-01-01', endDate: '2026-01-10' }); await flush();
      expect(workspace.context().notes).toEqual([note]);
      let resolveLoad!: (value: unknown) => void;
      service.loadRange.mockImplementationOnce(() => new Promise(resolve => { resolveLoad = resolve; }));
      report(key, { startDate: '2025-12-01', endDate: '2026-01-10' }); await flush();
      expect(workspace.context().notes).toEqual([note]);
      if (change === 'account') service.uid.set('another-owner');
      if (change === 'profile') fixture.componentRef.setInput('ownerUid', 'someone-else');
      if (change === 'hidden') service.showOnCharts.set(false);
      if (change === 'no ranges') report(key, null);
      fixture.detectChanges(); await flush();
      expect(workspace.context().notes).toEqual([]);
      resolveLoad({ notes: [note], incomplete: null }); await flush();
      expect(workspace.context().notes).toEqual([]);
      expect(workspace.loading()).toBe(false);
    },
  );

  it('immediately invalidates stale annotations after a note mutation, including pending responses', async () => {
    const report = component.context().reportRange;
    report({}, { startDate: '2026-01-01', endDate: '2026-01-10' }); await flush();
    let resolveLoad!: (value: unknown) => void;
    service.loadRange.mockImplementationOnce(() => new Promise(resolve => { resolveLoad = resolve; }));
    report({}, { startDate: '2025-12-01', endDate: '2026-01-10' }); await flush();
    expect(component.context().notes).toEqual([note]);
    service.loadRange.mockResolvedValueOnce({ notes: [], incomplete: null });
    service.changes$.next();
    expect(component.context().notes).toEqual([]);
    resolveLoad({ notes: [note], incomplete: null }); await flush();
    expect(component.context().notes).toEqual([]);
  });

  it('keeps the Notes action mounted and available while range loading changes, with out-of-flow progress', async () => {
    let resolveLoad!: (value: unknown) => void;
    service.loadRange.mockImplementation(() => new Promise(value => { resolveLoad = value; }));
    const fixture = TestBed.createComponent(TimelineNotesWorkspaceComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const button = host.querySelector<HTMLButtonElement>('.timeline-notes-button')!;
    const icon = button.querySelector('mat-icon');
    const progress = host.querySelector('mat-progress-bar')!;
    fixture.componentInstance.context().reportRange({}, { startDate: '2026-01-01', endDate: '2026-01-10' });
    await flush(); fixture.detectChanges();
    expect(host.querySelector('.timeline-notes-action')?.getAttribute('aria-busy')).toBe('true');
    expect(progress.classList.contains('timeline-notes-progress-visible')).toBe(true);
    expect(host.querySelector('[role="status"]')?.classList.contains('cdk-visually-hidden')).toBe(true);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('Timeline notes');
    expect(button.textContent).not.toContain('Loading');
    resolveLoad({ notes: [note], incomplete: null });
    await flush(); fixture.detectChanges();
    expect(host.querySelector('.timeline-notes-action')?.getAttribute('aria-busy')).toBe('false');
    expect(host.querySelector('.timeline-notes-button')).toBe(button);
    expect(button.querySelector('mat-icon')).toBe(icon);
    expect(host.querySelector('mat-progress-bar')).toBe(progress);
    expect(progress.classList.contains('timeline-notes-progress-visible')).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled();
    const styles = readFileSync(resolve(process.cwd(), 'src/app/components/timeline-notes/timeline-notes-workspace.component.scss'), 'utf8');
    expect(styles.match(/\.timeline-notes-progress\s*\{([^}]+)\}/)?.[1]).toContain('position: absolute;');
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
    component.context().reportRange({}, { startDate: '2026-01-01', endDate: '2026-01-10' });
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
  it('combines global and individual visibility without losing choices or accepting stale hidden markers', async () => {
    const hidden = { ...note, id: 'b'.repeat(64), showOnCharts: false };
    service.loadRange.mockResolvedValue({ notes: [note, hidden], incomplete: 'records' });
    component.context().reportRange({}, { startDate: '2026-01-01', endDate: '2026-01-10' });
    await flush();
    const context = component.context();
    expect(context.notes).toEqual([note]);
    expect(component.incomplete()).toBe('records');
    context.select([hidden]);
    expect(dialogs.open).not.toHaveBeenCalled();
    service.showOnCharts.set(false);
    context.select([note]);
    await flush();
    expect(component.context().notes).toEqual([]);
    service.showOnCharts.set(true); await flush();
    expect(component.context().notes).toEqual([note]);
    service.loadRange.mockResolvedValue({ notes: [{ ...note, showOnCharts: false }, hidden], incomplete: null });
    component.refresh(); await flush();
    expect(component.context().notes).toEqual([]);
    context.select([note]);
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    // The manager remains available even when no notes are plotted.
    component.open();
    expect(dialogs.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: { uid: 'owner', notes: undefined } }));
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

  it('clears a retained context on destruction and ignores late loads and range registrations', async () => {
    const fixture = TestBed.createComponent(TimelineNotesWorkspaceComponent);
    fixture.componentRef.setInput('ownerUid', 'owner');
    fixture.componentRef.setInput('visibleRange', { startDate: '2026-01-01', endDate: '2026-01-10' });
    fixture.detectChanges(); await flush();
    const workspace = fixture.componentInstance;
    const retainedSource = workspace.context;
    const oldContext = retainedSource();
    expect(oldContext.notes).toEqual([note]);
    fixture.destroy();
    expect(retainedSource()).toMatchObject({ ownerUid: null, notes: [] });
    oldContext.select([note]);
    oldContext.reportRange({}, { startDate: '2026-02-01', endDate: '2026-02-10' });
    await flush();
    expect(service.loadRange).toHaveBeenCalledOnce();
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();

    let resolveLoad!: (value: unknown) => void;
    service.loadRange.mockImplementation(() => new Promise(resolve => { resolveLoad = resolve; }));
    const pending = TestBed.createComponent(TimelineNotesWorkspaceComponent);
    pending.componentRef.setInput('visibleRange', { startDate: '2026-01-01', endDate: '2026-01-10' });
    pending.detectChanges(); await flush();
    expect(pending.componentInstance.loading()).toBe(true);
    pending.destroy();
    resolveLoad({ notes: [note], incomplete: 'records' });
    await flush();
    expect(pending.componentInstance.context()).toMatchObject({ ownerUid: null, notes: [] });
    expect(pending.componentInstance.loading()).toBe(false);
    expect(pending.componentInstance.incomplete()).toBeNull();
  });

  it('fences a dashboard profile independently of the signed-in account and rejects destroyed selections', async () => {
    const fixture = TestBed.createComponent(TimelineNotesWorkspaceComponent);
    fixture.componentRef.setInput('ownerUid', 'someone-else');
    fixture.componentRef.setInput('visibleRange', { startDate: '2026-01-01', endDate: '2026-01-10' });
    fixture.detectChanges(); await flush();
    expect(service.loadRange).not.toHaveBeenCalled();
    expect(fixture.componentInstance.context().notes).toEqual([]);
    fixture.componentInstance.open();
    expect(dialogs.open).not.toHaveBeenCalled();

    fixture.componentRef.setInput('ownerUid', 'owner');
    fixture.detectChanges(); await flush();
    const context = fixture.componentInstance.context();
    expect(context.ownerUid).toBe('owner');
    expect(context.notes).toEqual([note]);
    fixture.componentRef.setInput('ownerUid', 'someone-else');
    fixture.detectChanges();
    context.select([note]);
    expect(fixture.componentInstance.context().notes).toEqual([]);
    expect(dialogs.open).not.toHaveBeenCalled();

    fixture.componentRef.setInput('ownerUid', 'owner');
    fixture.detectChanges(); await flush();
    fixture.destroy();
    context.select([note]);
    expect(dialogs.open).not.toHaveBeenCalled();
  });
});
