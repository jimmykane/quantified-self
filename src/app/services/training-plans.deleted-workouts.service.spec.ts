import { TestBed } from '@angular/core/testing';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETED_WORKOUT_RECOVERY_MS } from '@shared/training-plans';
import { Firestore, getDocsFromServer, query, startAfter, where } from 'app/firebase/firestore';
import { AppFunctionsService } from './app.functions.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { TrainingPlansService } from './training-plans.service';

vi.mock('app/firebase/firestore', () => {
  class MockFirestore {}
  return {
    Firestore: MockFirestore,
    collection: vi.fn((_db, ...path: string[]) => ({ path })),
    documentId: vi.fn(() => '__name__'),
    getDocsFromServer: vi.fn(),
    limit: vi.fn((value: number) => ({ type: 'limit', value })),
    orderBy: vi.fn((field: string, direction: string) => ({ type: 'orderBy', field, direction })),
    query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
    startAfter: vi.fn((...values: unknown[]) => ({ type: 'startAfter', values })),
    where: vi.fn((field: string, operator: string, value: unknown) => ({ type: 'where', field, operator, value })),
  };
});

const NOW_MS = Date.UTC(2026, 8, 29);
const STRUCTURE = { version: 1, sport: ActivityTypes.Running, nodes: [{
  kind: 'step', id: 'steady', purpose: 'work', ending: { kind: 'time', seconds: 300 }, targets: [],
}] };

function row(id: string, deletedAtMs: number) {
  return { id, data: () => ({ schemaVersion: 1, id, planId: null, localDate: '2026-09-29',
    lifecycle: 'deleted', title: id, structure: STRUCTURE, revision: 2,
    createdAtMs: 1, updatedAtMs: deletedAtMs, deletedAtMs }) };
}

describe('owner deleted-workout pages', () => {
  let service: TrainingPlansService;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    TestBed.configureTestingModule({ providers: [TrainingPlansService,
      { provide: Firestore, useValue: {} }, { provide: AppFunctionsService, useValue: {} },
      { provide: BrowserCompatibilityService, useValue: {} }] });
    service = TestBed.inject(TrainingPlansService);
  });
  afterEach(() => vi.restoreAllMocks());

  it('uses a server page, a strict 90-day cutoff, and an ordered two-field cursor', async () => {
    const sameTimestamp = NOW_MS - 1000;
    const first = Array.from({ length: 26 }, (_, index) => row(`w${`${26 - index}`.padStart(2, '0')}`, sameTimestamp));
    vi.mocked(getDocsFromServer).mockResolvedValueOnce({ docs: first } as never)
      .mockResolvedValueOnce({ docs: [row('older', sameTimestamp - 1)] } as never);
    const page = await service.getDeletedWorkoutsPage('owner', null);
    expect(page.workouts).toHaveLength(25);
    expect(page.nextCursor).toEqual({ deletedAtMs: sameTimestamp, id: 'w02' });
    expect(where).toHaveBeenCalledWith('deletedAtMs', '>', NOW_MS - DELETED_WORKOUT_RECOVERY_MS);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ path: ['users', 'owner', 'scheduledWorkouts'] }),
      expect.objectContaining({ type: 'where', field: 'planId', value: null }),
      expect.objectContaining({ type: 'where', field: 'lifecycle', value: 'deleted' }),
      expect.objectContaining({ type: 'where', field: 'deletedAtMs' }),
      expect.objectContaining({ type: 'orderBy', field: 'deletedAtMs', direction: 'desc' }),
      expect.objectContaining({ type: 'orderBy', field: '__name__', direction: 'desc' }),
      expect.objectContaining({ type: 'limit', value: 26 }));
    const next = await service.getDeletedWorkoutsPage('owner', null, page.nextCursor);
    expect(startAfter).toHaveBeenCalledWith(sameTimestamp, 'w02');
    expect(next).toMatchObject({ nextCursor: null, workouts: [expect.objectContaining({ id: 'older' })] });
  });

  it('requires an owner identity before any Firestore read', async () => {
    await expect(service.getDeletedWorkoutsPage('', null)).rejects.toThrow('Sign in');
    expect(getDocsFromServer).not.toHaveBeenCalled();
  });
});
