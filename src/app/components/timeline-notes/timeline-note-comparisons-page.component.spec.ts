import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineNote } from '@shared/timeline-notes';
import { comparisonDateLabel } from '../../helpers/timeline-note-comparison.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppTimelineNotesService, type TimelineNotesPage } from '../../services/app.timeline-notes.service';
import { ShellNavigationEffectsService } from '../../services/shell-navigation-effects.service';
import { TimelineNoteComparisonsPageComponent } from './timeline-note-comparisons-page.component';

const note: TimelineNote = { id: 'a'.repeat(64), title: 'Stopped late coffee', details: 'Private detail', category: 'other',
  startDate: '2026-09-30', endDate: null, timeZone: 'Europe/Helsinki', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
describe('Note comparisons landing page', () => {
  const uid = signal<string | null>('owner'), changes$ = new Subject<void>(), closed$ = new Subject<void>();
  const notes = { uid, changes$, isOwner: (id: string) => id === uid(), list: vi.fn() };
  const dialogs = { open: vi.fn(), openDialogs: [] as Array<{ componentInstance: object }> };
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const flush = async (fixture: ReturnType<typeof TestBed.createComponent<TimelineNoteComparisonsPageComponent>>) => {
    for (let i = 0; i < 6; i++) { fixture.detectChanges(); TestBed.flushEffects(); await Promise.resolve(); }
    fixture.detectChanges();
  };
  const render = async () => {
    const fixture = TestBed.createComponent(TimelineNoteComparisonsPageComponent); await flush(fixture); return fixture;
  };
  beforeEach(() => {
    vi.clearAllMocks(); uid.set('owner'); dialogs.openDialogs = [];
    notes.list.mockResolvedValue({ notes: [note], cursor: null });
    dialogs.open.mockReturnValue({ afterClosed: () => closed$ });
    TestBed.configureTestingModule({ imports: [TimelineNoteComparisonsPageComponent], providers: [
      provideRouter([{ path: '**', children: [] }]), { provide: AppTimelineNotesService, useValue: notes },
      { provide: MatDialog, useValue: dialogs }, { provide: AppHapticsService, useValue: haptics },
    ] });
  });
  it('opens comparisons through saved-note links, never the editor on arrival or selection', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    TestBed.inject(ShellNavigationEffectsService); await TestBed.inject(Router).navigateByUrl('/health/compare');
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('main').classList.contains('qs-workspace-page')).toBe(true);
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Note comparisons');
    const link = fixture.nativeElement.querySelector('a.comparison-note') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(`/health/compare/${note.id}`);
    expect(link.textContent).toContain(note.title); expect(link.textContent).toContain(comparisonDateLabel(note.startDate));
    expect(link.textContent).toContain('Ongoing'); expect(fixture.nativeElement.textContent).not.toContain('Private detail');
    expect(dialogs.open).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
    link.click(); await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe(`/health/compare/${note.id}`);
    expect(dialogs.open).not.toHaveBeenCalled(); expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('includes future and chart-hidden notes with their shared appearance and date labels', async () => {
    notes.list.mockResolvedValue({ notes: [{ ...note, showOnCharts: false, category: 'travel', color: 'blue',
      startDate: '2027-01-01', endDate: '2027-01-03' }], cursor: null });
    const fixture = await render(), link = fixture.nativeElement.querySelector('a.comparison-note');
    expect(link.textContent).toContain(`${comparisonDateLabel('2027-01-01')} – ${comparisonDateLabel('2027-01-03')}`);
    expect(link.textContent).toContain('Hidden on charts');
    expect(link.querySelector('mat-icon').textContent).toBe('flight');
  });
  it('explains empty notes without forcing the add-note dialog', async () => {
    notes.list.mockResolvedValue({ notes: [], cursor: null }); const fixture = await render();
    expect(fixture.nativeElement.textContent).toContain('No saved notes yet');
    expect(fixture.nativeElement.querySelector('button').textContent).toContain('Manage notes');
    expect(dialogs.open).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('shows a read failure honestly and retries with one tap, not mutation feedback', async () => {
    notes.list.mockRejectedValueOnce(new Error('offline')); const fixture = await render();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Could not load');
    const retry = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(button => button.textContent.trim() === 'Retry');
    retry.click(); await flush(fixture);
    expect(fixture.nativeElement.querySelector('a.comparison-note')).not.toBeNull(); expect(haptics.selection).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled(); expect(haptics.error).not.toHaveBeenCalled();
  });
  it('paginates using existing bounded cursors and resets after a note change without background feedback', async () => {
    const cursor = { id: 'cursor' } as QueryDocumentSnapshot;
    notes.list.mockResolvedValueOnce({ notes: [note], cursor }); const fixture = await render();
    fixture.componentInstance.older(); await flush(fixture); expect(notes.list).toHaveBeenLastCalledWith('owner', cursor);
    expect(fixture.componentInstance.pageNumber()).toBe(1);
    fixture.componentInstance.newer(); await flush(fixture); expect(notes.list).toHaveBeenLastCalledWith('owner', null);
    changes$.next(); await flush(fixture); expect(fixture.componentInstance.pageNumber()).toBe(0);
    expect(haptics.selection).not.toHaveBeenCalled(); expect(haptics.success).not.toHaveBeenCalled();
  });
  it('keeps Manage notes as an explicit separate action with duplicate-open protection and a refreshed list on close', async () => {
    const fixture = await render();
    await fixture.componentInstance.manageNotes(); await fixture.componentInstance.manageNotes();
    expect(dialogs.open).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      width: '560px', maxWidth: 'calc(100vw - 32px)', data: { uid: 'owner' },
    });
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(haptics.success).not.toHaveBeenCalled();
    closed$.next(); await flush(fixture); expect(fixture.componentInstance.managerOpen()).toBe(false);
    expect(notes.list).toHaveBeenCalledTimes(2);
  });
  it('allows retry after an explicit manager-open failure', async () => {
    const fixture = await render(); dialogs.open.mockImplementationOnce(() => { throw new Error('failed'); });
    await fixture.componentInstance.manageNotes(); await flush(fixture);
    expect(fixture.componentInstance.managerOpening()).toBe(false); expect(fixture.nativeElement.textContent).toContain('could not open');
    expect(haptics.error).toHaveBeenCalledOnce(); await fixture.componentInstance.manageNotes();
    expect(dialogs.open).toHaveBeenCalledTimes(2);
  });
  it('does not open a manager after logout/login to the same uid or after leaving the page', async () => {
    const fixture = await render();
    const opening = fixture.componentInstance.manageNotes();
    uid.set(null); changes$.next(); uid.set('owner'); changes$.next(); await opening;
    expect(dialogs.open).not.toHaveBeenCalled();
    const leaving = fixture.componentInstance.manageNotes(); fixture.destroy(); await leaving;
    expect(dialogs.open).not.toHaveBeenCalled(); expect(haptics.error).not.toHaveBeenCalled();
  });
  it('discards a stale page after owner changes and immediately removes the old owner’s rows', async () => {
    const fixture = await render(); let finish!: (page: TimelineNotesPage) => void;
    notes.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    changes$.next(); await flush(fixture); expect(fixture.nativeElement.querySelector('mat-progress-bar')).not.toBeNull();
    notes.list.mockResolvedValue({ notes: [], cursor: null }); uid.set('other'); await flush(fixture);
    finish({ notes: [note], cursor: null }); await flush(fixture);
    expect(fixture.componentInstance.rows()).toEqual([]); expect(fixture.nativeElement.textContent).not.toContain(note.title);
    expect(notes.list).toHaveBeenLastCalledWith('other', null); expect(haptics.error).not.toHaveBeenCalled();
  });
  it('fences logout/login to the same uid and component teardown during reads', async () => {
    let finish!: (page: TimelineNotesPage) => void;
    notes.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const fixture = await render();
    uid.set(null); changes$.next(); uid.set('owner'); changes$.next(); await flush(fixture);
    notes.list.mockResolvedValue({ notes: [], cursor: null }); changes$.next(); await flush(fixture);
    finish({ notes: [note], cursor: null }); await flush(fixture); expect(fixture.componentInstance.rows()).toEqual([]);
    notes.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); changes$.next(); await flush(fixture);
    fixture.destroy(); finish({ notes: [note], cursor: null }); await Promise.resolve();
    expect(fixture.componentInstance.rows()).toEqual([]); expect(haptics.error).not.toHaveBeenCalled();
  });
});
