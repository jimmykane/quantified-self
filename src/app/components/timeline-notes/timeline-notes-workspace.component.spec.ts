import { TestBed } from '@angular/core/testing';
import { Component, signal, viewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineNotesWorkspaceComponent } from './timeline-notes-workspace.component';
import { ActiveSicknessNoteComponent } from './active-sickness-note.component';
import { AppTimelineNotesService, loadTimelineNotePages } from '../../services/app.timeline-notes.service';
import type { TimelineNote, TimelineNoteRange } from '@shared/timeline-notes';
import { AppHapticsService } from '../../services/app.haptics.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

@Component({ standalone: true, imports: [TimelineNotesWorkspaceComponent, ActiveSicknessNoteComponent],
  template: '<app-timeline-notes-workspace #notes ownerUid="owner" /><app-active-sickness-note [context]="notes.context()" />' })
class CurrentSicknessWorkspaceHost {
  readonly workspace = viewChild.required(TimelineNotesWorkspaceComponent);
  readonly sickness = viewChild.required(ActiveSicknessNoteComponent);
}

describe('Timeline notes workspace ownership', () => {
  const note = { id: 'a'.repeat(64), category: 'other' as const, title: 'Private', startDate: '2026-01-02', endDate: '2026-01-02', timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
  const service = { uid: signal<string | null>('owner'), showOnCharts: signal(true), changes$: new Subject<void>(), loadRange: vi.fn(), cachedRange: vi.fn(() => null), invalidate: vi.fn(), isOwner: (uid: string) => service.uid() === uid };
  const dialogs = { open: vi.fn() };
  const haptics = { selection: vi.fn() };
  let component: TimelineNotesWorkspaceComponent;
  const flush = async () => { TestBed.flushEffects(); await Promise.resolve(); await Promise.resolve(); };
  beforeEach(() => {
    vi.clearAllMocks(); service.uid.set('owner'); service.showOnCharts.set(true); service.loadRange.mockReset().mockResolvedValue({ notes: [note], incomplete: null });
    service.cachedRange.mockReturnValue(null);
    service.invalidate.mockImplementation(() => service.changes$.next());
    TestBed.configureTestingModule({ providers: [{ provide: AppTimelineNotesService, useValue: service }, { provide: MatDialog, useValue: dialogs }, { provide: AppHapticsService, useValue: haptics }] });
    component = TestBed.runInInjectionContext(() => new TimelineNotesWorkspaceComponent());
  });
  let visibility: ReturnType<typeof vi.spyOn>;
  let clock: ReturnType<typeof vi.spyOn>;
  afterEach(() => { visibility?.mockRestore(); clock?.mockRestore(); });
  it('keeps annotations visible through paired visibility and focus events, including a delayed refresh', async () => {
    visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    component.context().reportRange({}, { startDate: '2026-01-01', endDate: '2026-01-10' });
    await flush();
    const rendered = component.context();
    service.cachedRange.mockReturnValue({ notes: [note], incomplete: null });
    let finish!: (value: unknown) => void;
    service.loadRange.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(component.context()).toBe(rendered);
    expect(component.loading()).toBe(false);
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(service.loadRange).toHaveBeenCalledTimes(2);
    expect(component.context()).toBe(rendered);
    finish({ notes: [{ ...note }], incomplete: null });
    await flush();
    expect(component.context()).toBe(rendered);
    expect(service.invalidate).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it.each([{ state: 'empty', notes: [] }, { state: 'populated', notes: [note] }])(
    'quietly revalidates a returning workspace with a $state cache', async ({ notes }) => {
      const cached = { notes, incomplete: null };
      service.cachedRange.mockReturnValue(cached);
      let finish!: (value: unknown) => void;
      service.loadRange.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      component.context().reportRange({}, { startDate: '2026-01-01', endDate: '2026-01-10' });
      await flush();
      expect(component.loading()).toBe(false);
      expect(component.context().notes).toEqual(notes);
      expect(service.invalidate).not.toHaveBeenCalled();
      finish({ notes: [], incomplete: null }); await flush();
      expect(component.context().notes).toEqual([]);
    });
  it.each(['records', 'bytes'] as const)('keeps an incomplete %s cache pending until the bounded current read settles', async incomplete => {
    const range = { startDate: '2026-01-01', endDate: '2026-01-10' };
    const currentRange = { startDate: '2026-01-02', endDate: '2026-01-03' };
    const cached = { notes: [note], incomplete };
    service.cachedRange.mockReturnValue(cached);
    let finishUnion!: (value: unknown) => void;
    let finishCurrent!: (value: unknown) => void;
    service.loadRange.mockImplementationOnce(() => new Promise(resolve => { finishUnion = resolve; }));
    service.loadRange.mockImplementationOnce(() => new Promise(resolve => { finishCurrent = resolve; }));
    component.context().reportRange({}, range);
    component.context().reportCurrentRange!({}, () => currentRange);
    await flush();
    expect(component.context().notes).toEqual([note]);
    expect(component.incomplete()).toBe(incomplete);
    expect(component.loading()).toBe(true);
    finishUnion(cached); await flush();
    expect(service.loadRange).toHaveBeenLastCalledWith('owner', currentRange, false);
    expect(component.loading()).toBe(true);
    finishCurrent({ notes: [], incomplete: null }); await flush();
    expect(component.loading()).toBe(false);
    expect(component.context().currentNotes).toEqual([]);
  });
  it('keeps a newer quiet refresh deduplicated when an older window finishes first', async () => {
    visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const range = { startDate: '2026-01-01', endDate: '2026-01-10' };
    const key = {};
    component.context().reportRange(key, range); await flush();
    let finishOlder!: (value: unknown) => void;
    let finishCurrent!: (value: unknown) => void;
    service.loadRange.mockImplementationOnce(() => new Promise(resolve => { finishOlder = resolve; }));
    component.context().reportRange(key, { startDate: '2026-02-01', endDate: '2026-02-10' }); await flush();
    service.cachedRange.mockReturnValue({ notes: [note], incomplete: null });
    service.loadRange.mockImplementationOnce(() => new Promise(resolve => { finishCurrent = resolve; }));
    component.context().reportRange(key, range); await flush();
    expect(component.loading()).toBe(false);
    finishOlder({ notes: [], incomplete: null }); await flush();
    window.dispatchEvent(new Event('focus')); await flush();
    expect(service.loadRange).toHaveBeenCalledTimes(3);
    expect(component.context().notes).toEqual([note]);
    finishCurrent({ notes: [], incomplete: null }); await flush();
    expect(component.context().notes).toEqual([]);
  });
  it('retains notes after a failed foreground refresh and allows an explicit retry', async () => {
    visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    component.context().reportRange({}, { startDate: '2026-01-01', endDate: '2026-01-10' }); await flush();
    const rendered = component.context();
    service.cachedRange.mockReturnValue({ notes: [note], incomplete: null });
    service.loadRange.mockRejectedValueOnce(new Error('offline'));
    window.dispatchEvent(new Event('focus')); await flush();
    expect(component.error()).toBe(true);
    expect(component.context()).toBe(rendered);
    let finish!: (value: unknown) => void;
    service.loadRange.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    component.refresh(); await flush();
    expect(service.loadRange).toHaveBeenLastCalledWith('owner', { startDate: '2026-01-01', endDate: '2026-01-10' }, true);
    expect(component.loading()).toBe(true);
    expect(component.context()).toBe(rendered);
    finish({ notes: [{ ...note, title: 'Updated', revision: 2 }], incomplete: null }); await flush();
    expect(component.context().notes[0].revision).toBe(2);
    expect(component.error()).toBe(false);
  });
  it('ignores hidden-tab events and only reprojects unchanged ongoing notes when their local date changes', async () => {
    clock = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 0, 2, 21, 59));
    const ongoing = { ...note, endDate: null, timeZone: 'Europe/Helsinki' };
    service.loadRange.mockResolvedValue({ notes: [ongoing], incomplete: null });
    component.context().reportRange({}, { startDate: '2026-01-01', endDate: '2026-01-10' }); await flush();
    const rendered = component.context();
    visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); await flush();
    expect(service.loadRange).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    window.dispatchEvent(new Event('focus')); await flush();
    expect(component.context()).toBe(rendered);
    clock.mockReturnValue(Date.UTC(2026, 0, 2, 22, 1));
    window.dispatchEvent(new Event('focus')); await flush();
    expect(component.context()).not.toBe(rendered);
    expect(component.context().notes).toEqual([ongoing]);
    const nextDay = component.context();
    window.dispatchEvent(new Event('focus')); await flush();
    expect(component.context()).toBe(nextDay);
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
    expect(service.loadRange).toHaveBeenCalledWith('owner', { startDate: '2025-12-01', endDate: '2026-01-10' }, false);
    expect(component.context().notes).toEqual([note]);
    component.context().select([note]); expect(dialogs.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: { uid: 'owner', notes: [note] } }));
  });
  it('coalesces the sickness context with chart reads and leaves chart context unchanged after an identical refresh', async () => {
    clock = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 0, 2, 12));
    const fixture = TestBed.createComponent(CurrentSicknessWorkspaceHost);
    fixture.detectChanges();
    const workspace = fixture.componentInstance.workspace();
    workspace.context().reportRange({}, { startDate: '2026-01-01', endDate: '2026-01-10' });
    await flush(); fixture.detectChanges(); await flush();
    expect(service.loadRange).toHaveBeenCalledExactlyOnceWith('owner', { startDate: '2026-01-01', endDate: '2026-01-10' }, false);
    const chartContext = workspace.context();
    service.loadRange.mockClear();
    window.dispatchEvent(new Event('focus')); await flush(); fixture.detectChanges(); await flush();
    expect(service.loadRange).toHaveBeenCalledExactlyOnceWith('owner', { startDate: '2026-01-01', endDate: '2026-01-10' }, false);
    expect(workspace.context()).toBe(chartContext);
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('resolves today before a foreground read, without first loading yesterday or repeating the new window', async () => {
    clock = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 24, 23, 59));
    visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const fixture = TestBed.createComponent(CurrentSicknessWorkspaceHost);
    fixture.detectChanges(); await flush(); fixture.detectChanges(); await flush();
    expect(service.loadRange).toHaveBeenCalledOnce(); service.loadRange.mockClear();
    visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'));
    clock.mockReturnValue(Date.UTC(2026, 9, 25, 0, 1));
    visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
    // Reproduce browser ordering: the workspace microtask runs before the child's clock effect.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    fixture.detectChanges(); await flush(); fixture.detectChanges(); await flush();
    expect(service.loadRange).toHaveBeenCalledExactlyOnceWith('owner', { startDate: '2026-10-24', endDate: '2026-10-26' }, false);
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('keeps a current sickness link selectable when 512 older records cap the expanded chart window', async () => {
    clock = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 24, 12));
    const current: TimelineNote = { ...note, id: 'f'.repeat(64), category: 'sickness', startDate: '2026-10-21', endDate: '2026-10-24' };
    const historical = Array.from({ length: 512 }, (_, index) => ({ ...note, id: index.toString(16).padStart(64, '0') }));
    service.loadRange.mockImplementation((_uid: string, range: TimelineNoteRange) => loadTimelineNotePages(range, async (ongoing, cursor, size) => {
      if (ongoing) return { rows: [], cursor: null };
      const rows = [...historical, current].filter(value => value.startDate <= range.endDate && value.endDate! >= range.startDate);
      const start = typeof cursor === 'number' ? cursor + 1 : 0;
      return { rows: rows.slice(start, start + size).map(value => ({ id: value.id, data: value })), cursor: start + size - 2 };
    }, () => true));
    const fixture = TestBed.createComponent(CurrentSicknessWorkspaceHost);
    const settle = async () => {
      await flush(); await Promise.all(service.loadRange.mock.results.map(result => result.value));
      fixture.detectChanges(); await flush();
    };
    fixture.detectChanges(); await settle(); await settle();
    const workspace = fixture.componentInstance.workspace();
    expect(fixture.componentInstance.sickness().hasActiveSickness()).toBe(true);
    workspace.context().reportRange({}, { startDate: '2026-01-01', endDate: '2026-10-25' });
    await settle(); await settle();
    expect(workspace.incomplete()).toBe('records');
    expect(workspace.context().notes).toHaveLength(512);
    expect(workspace.context().currentNotes).toEqual([current]);
    expect(fixture.componentInstance.sickness().hasActiveSickness()).toBe(true);
    fixture.nativeElement.querySelector('app-active-sickness-note button').click();
    expect(dialogs.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: { uid: 'owner', notes: [current] } }));
    expect(service.loadRange).toHaveBeenCalledTimes(3); // Initial union, capped history, bounded current fallback.
    expect(service.loadRange).toHaveBeenLastCalledWith('owner', { startDate: '2026-10-23', endDate: '2026-10-25' }, false);
  });
  it.each(['complete', 'partial', 'error'] as const)('only removes retained current context after a complete bounded read: %s', async outcome => {
    clock = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 24, 12));
    const current = { ...note, category: 'sickness' as const, startDate: '2026-10-21', endDate: '2026-10-24' };
    service.loadRange.mockResolvedValueOnce({ notes: [current], incomplete: null });
    component.context().reportCurrentRange!({}, () => ({ startDate: '2026-10-23', endDate: '2026-10-25' })); await flush();
    service.loadRange.mockResolvedValueOnce({ notes: [], incomplete: 'records' });
    if (outcome === 'error') service.loadRange.mockRejectedValueOnce(new Error('offline'));
    else service.loadRange.mockResolvedValueOnce({ notes: [], incomplete: outcome === 'partial' ? 'records' : null });
    component.context().reportRange({}, { startDate: '2026-01-01', endDate: '2026-10-25' }); await flush(); await flush();
    expect(component.context().currentNotes).toEqual(outcome === 'complete' ? [] : [current]);
    expect(component.error()).toBe(outcome === 'error');
  });
  it.each(['mutation', 'owner', 'visibility', 'unregister'] as const)('clears bounded current evidence and rejects a late fallback after %s', async change => {
    const key = {};
    component.context().reportCurrentRange!(key, () => ({ startDate: '2026-01-01', endDate: '2026-01-10' })); await flush();
    expect(component.context().currentNotes).toEqual([note]);
    let finish!: (value: unknown) => void;
    service.loadRange.mockResolvedValueOnce({ notes: [], incomplete: 'records' });
    service.loadRange.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    component.context().reportRange({}, { startDate: '2025-01-01', endDate: '2026-01-10' }); await flush();
    if (change === 'mutation') service.changes$.next();
    if (change === 'owner') service.uid.set('someone-else');
    if (change === 'visibility') service.showOnCharts.set(false);
    if (change === 'unregister') component.context().reportCurrentRange!(key, null);
    service.loadRange.mockResolvedValue({ notes: [], incomplete: null }); await flush();
    expect(component.context().currentNotes).toEqual([]);
    finish({ notes: [note], incomplete: null }); await flush();
    expect(component.context().currentNotes).toEqual([]);
  });
  it('bounds retained current context across repeated partial results while accepting updated revisions', async () => {
    const initial = Array.from({ length: 512 }, (_, index) => ({ ...note, id: index.toString(16).padStart(64, '0') }));
    service.loadRange.mockResolvedValueOnce({ notes: initial, incomplete: 'records' });
    component.context().reportCurrentRange!({}, () => ({ startDate: '2026-01-01', endDate: '2026-01-10' })); await flush();
    const updated = { ...initial[0], showOnCharts: false, revision: 2 };
    service.loadRange.mockResolvedValueOnce({ notes: [updated, { ...note, id: 'f'.repeat(64) }], incomplete: 'records' });
    component.refresh(); await flush();
    // Hidden updates replace retained evidence; extra partial pages cannot grow the bounded projection.
    expect(component.context().currentNotes).toHaveLength(511);
    expect(component.context().currentNotes?.some(value => value.id === updated.id)).toBe(false);
    service.changes$.next();
    expect(component.context().currentNotes).toEqual([]);
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
    service.cachedRange.mockReturnValue({ notes: [note], incomplete: null });
    fixture.componentInstance.refresh(false); await flush(); fixture.detectChanges();
    expect(host.querySelector('.timeline-notes-action')?.getAttribute('aria-busy')).toBe('false');
    expect(progress.classList.contains('timeline-notes-progress-visible')).toBe(false);
    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe('');
    resolveLoad({ notes: [note], incomplete: null }); await flush();
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
    expect(service.loadRange).toHaveBeenCalledExactlyOnceWith('owner', { startDate: '2025-11-01', endDate: '2026-01-10' }, false);
    expect(component.context().notes).toEqual([note]);
    report(heartRate, null); report(hrv, null);
    await flush();
    expect(service.loadRange).toHaveBeenLastCalledWith('owner', { startDate: '2025-11-01', endDate: '2025-11-30' }, false);
  });
  it('loads an explicit calendar range, refreshes navigation, and honors the global visibility preference', async () => {
    const fixture = TestBed.createComponent(TimelineNotesWorkspaceComponent);
    fixture.componentRef.setInput('visibleRange', { startDate: '2026-01-01', endDate: '2026-01-31' });
    fixture.detectChanges(); await fixture.whenStable(); await flush();
    expect(service.loadRange).toHaveBeenLastCalledWith('owner', { startDate: '2026-01-01', endDate: '2026-01-31' }, false);
    fixture.componentRef.setInput('visibleRange', { startDate: '2026-02-01', endDate: '2026-02-28' });
    fixture.detectChanges(); await fixture.whenStable(); await flush();
    expect(service.loadRange).toHaveBeenLastCalledWith('owner', { startDate: '2026-02-01', endDate: '2026-02-28' }, false);
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
