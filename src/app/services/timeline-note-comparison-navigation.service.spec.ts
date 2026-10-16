import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationCancel, NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTimelineNotesService } from './app.timeline-notes.service';
import { TimelineNoteComparisonNavigationService } from './timeline-note-comparison-navigation.service';

describe('Timeline comparison return navigation', () => {
  const uid = signal<string | null>('owner');
  const events$ = new Subject<unknown>();
  const router = { url: '/dashboard?range=90d', events: events$.asObservable(), navigate: vi.fn(), navigateByUrl: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks(); uid.set('owner'); router.url = '/dashboard?range=90d'; router.navigate.mockResolvedValue(true);
    router.navigateByUrl.mockImplementation(async url => {
      router.url = url; events$.next(new NavigationEnd(4, url, url)); return true;
    });
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: router },
      { provide: AppTimelineNotesService, useValue: { uid, isOwner: (id: string) => id === uid() } }] });
  });
  it('keeps the source URL and list page only in owner-scoped memory', async () => {
    const service = TestBed.inject(TimelineNoteComparisonNavigationService), list = { page: 1, cursors: [null, null] };
    TestBed.flushEffects();
    expect(await service.compare('owner', 'a'.repeat(64), list)).toBe(true);
    expect(router.navigate).toHaveBeenCalledExactlyOnceWith(['/health/compare', 'a'.repeat(64)]);
    const destination = `/health/compare/${'a'.repeat(64)}`;
    events$.next(new NavigationEnd(1, destination, destination));
    events$.next(new NavigationEnd(2, `${destination}?view=history#chart`, `${destination}?view=history#chart`));
    expect(await service.returnToNotes('owner')).toEqual({ restoreList: list });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/dashboard?range=90d');
  });
  it('rejects another owner and drops return context across account changes', async () => {
    const service = TestBed.inject(TimelineNoteComparisonNavigationService); TestBed.flushEffects();
    expect(await service.compare('other', 'a'.repeat(64), { page: 0, cursors: [null] })).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
    await service.compare('owner', 'a'.repeat(64), { page: 2, cursors: [null, null, null] });
    uid.set(null); TestBed.flushEffects(); uid.set('owner'); TestBed.flushEffects();
    expect(await service.returnToNotes('owner')).toEqual({ restoreList: null });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/health/compare');
  });
  it('retains the original manager context when return navigation is cancelled', async () => {
    const service = TestBed.inject(TimelineNoteComparisonNavigationService), list = { page: 1, cursors: [null, null] };
    TestBed.flushEffects();
    await service.compare('owner', 'a'.repeat(64), list);
    router.navigateByUrl.mockResolvedValueOnce(false);
    events$.next(new NavigationCancel(2, '/dashboard?range=90d', 'guard cancelled'));
    expect(await service.returnToNotes('owner')).toBeNull();
    expect(await service.returnToNotes('owner')).toEqual({ restoreList: list });
    expect(router.navigateByUrl).toHaveBeenLastCalledWith('/dashboard?range=90d');
  });
  it.each(['same note', 'different note'])('drops stale context after browser Back and a later direct visit to the %s', async target => {
    const service = TestBed.inject(TimelineNoteComparisonNavigationService);
    TestBed.flushEffects();
    await service.compare('owner', 'a'.repeat(64), { page: 2, cursors: [null, null, null] });
    const original = `/health/compare/${'a'.repeat(64)}`;
    events$.next(new NavigationEnd(1, original, original));
    events$.next(new NavigationEnd(2, '/dashboard?range=90d', '/dashboard?range=90d'));
    const direct = `/health/compare/${(target === 'same note' ? 'a' : 'b').repeat(64)}`;
    router.url = direct;
    events$.next(new NavigationEnd(3, direct, direct));
    expect(await service.returnToNotes('owner')).toEqual({ restoreList: null });
    expect(router.navigateByUrl).toHaveBeenLastCalledWith('/health/compare');
  });
  it('returns direct and sidenav comparisons to their landing page without requesting a manager', async () => {
    const service = TestBed.inject(TimelineNoteComparisonNavigationService); TestBed.flushEffects();
    router.url = `/health/compare/${'a'.repeat(64)}`;
    expect(await service.returnToNotes('owner')).toEqual({ restoreList: null });
    expect(router.navigateByUrl).toHaveBeenCalledExactlyOnceWith('/health/compare');
  });
});
