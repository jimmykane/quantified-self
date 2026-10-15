import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTimelineNotesService } from './app.timeline-notes.service';
import { TimelineNoteComparisonNavigationService } from './timeline-note-comparison-navigation.service';

describe('Timeline comparison return navigation', () => {
  const uid = signal<string | null>('owner');
  const router = { url: '/dashboard?range=90d', navigate: vi.fn(), navigateByUrl: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks(); uid.set('owner'); router.url = '/dashboard?range=90d'; router.navigate.mockResolvedValue(true);
    router.navigateByUrl.mockImplementation(async url => { router.url = url; return true; });
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: router },
      { provide: AppTimelineNotesService, useValue: { uid, isOwner: (id: string) => id === uid() } }] });
  });
  it('keeps the source URL and list page only in owner-scoped memory', async () => {
    const service = TestBed.inject(TimelineNoteComparisonNavigationService), list = { page: 1, cursors: [null, null] };
    TestBed.flushEffects();
    expect(await service.compare('owner', 'a'.repeat(64), list)).toBe(true);
    expect(router.navigate).toHaveBeenCalledExactlyOnceWith(['/health/compare', 'a'.repeat(64)]);
    expect(await service.returnToNotes('owner')).toBe(list);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/dashboard?range=90d');
  });
  it('rejects another owner and drops return context across account changes', async () => {
    const service = TestBed.inject(TimelineNoteComparisonNavigationService); TestBed.flushEffects();
    expect(await service.compare('other', 'a'.repeat(64), { page: 0, cursors: [null] })).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
    await service.compare('owner', 'a'.repeat(64), { page: 2, cursors: [null, null, null] });
    uid.set(null); TestBed.flushEffects(); uid.set('owner'); TestBed.flushEffects();
    expect(await service.returnToNotes('owner')).toEqual({ page: 0, cursors: [null] });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/health');
  });
  it('retains the original manager context when return navigation is cancelled', async () => {
    const service = TestBed.inject(TimelineNoteComparisonNavigationService), list = { page: 1, cursors: [null, null] };
    TestBed.flushEffects();
    await service.compare('owner', 'a'.repeat(64), list);
    router.navigateByUrl.mockResolvedValueOnce(false);
    expect(await service.returnToNotes('owner')).toBeNull();
    expect(await service.returnToNotes('owner')).toBe(list);
    expect(router.navigateByUrl).toHaveBeenLastCalledWith('/dashboard?range=90d');
  });
});
