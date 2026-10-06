import { TestBed } from '@angular/core/testing';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { firstValueFrom, of, throwError } from 'rxjs';
import { Firestore, collectionData, docData, where, limit } from 'app/firebase/firestore';
import { TrainingPlansService } from './training-plans.service';
import { AppFunctionsService } from './app.functions.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';

vi.mock('app/firebase/firestore', () => ({ Firestore: class {},
  collection: vi.fn((_db, ...path: string[]) => ({ path })), doc: vi.fn((_db, ...path: string[]) => ({ path })),
  documentId: vi.fn(() => '__name__'), docData: vi.fn(), collectionData: vi.fn(), getDoc: vi.fn(),
  limit: vi.fn(value => ({ limit: value })), orderBy: vi.fn((field, direction) => ({ field, direction })),
  query: vi.fn((ref, ...constraints) => ({ ref, constraints })), where: vi.fn((field, op, value) => ({ field, op, value })),
}));
const row = (id: string) => ({ schemaVersion: 1, id, planId: null, localDate: '2026-10-06', lifecycle: 'planned', title: id,
  revision: 1, createdAtMs: 1, updatedAtMs: 1, structure: { version: 1, sport: ActivityTypes.Running,
    nodes: [{ kind: 'step', id: 'step', purpose: 'work', ending: { kind: 'time', seconds: 60 }, targets: [] }] } });
describe('bounded Calendar Training reads', () => {
  let service: TrainingPlansService;
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({ providers: [TrainingPlansService, { provide: Firestore, useValue: {} },
      { provide: AppFunctionsService, useValue: {} }, { provide: BrowserCompatibilityService, useValue: {} }] });
    service = TestBed.inject(TrainingPlansService);
    vi.mocked(docData).mockReturnValue(of(undefined));
  });
  it('uses inclusive local dates with lookahead and never reports truncated workouts as a complete schedule', async () => {
    vi.mocked(collectionData).mockReturnValue(of(Array.from({ length: 401 }, (_, i) => row(`w${i}`))));
    const schedule = await firstValueFrom(service.watchCalendarSchedule('owner', '2026-10-05', '2026-10-11'));
    expect(schedule.workouts).toHaveLength(400); expect(schedule.workoutsComplete).toBe(false);
    expect(where).toHaveBeenCalledWith('localDate', '>=', '2026-10-05');
    expect(where).toHaveBeenCalledWith('localDate', '<=', '2026-10-11'); expect(limit).toHaveBeenCalledWith(401);
    expect(docData).toHaveBeenCalledTimes(2); // Availability and state; no all-plan scan.
  });
  it('keeps restore-fenced schedules unavailable without querying workouts', async () => {
    vi.mocked(docData).mockReturnValue(of({ operation: 'restore' }));
    expect((await firstValueFrom(service.watchCalendarSchedule('owner', '2026-10-05', '2026-10-11'))).restoreUnavailable).toBe(true);
    expect(collectionData).not.toHaveBeenCalled();
  });
  it('reads completion by exact ID in bounded batches, never by the old scheduled date', async () => {
    vi.mocked(collectionData).mockReturnValue(of([]));
    await firstValueFrom(service.watchWorkoutCompletionsForWorkouts('owner', Array.from({ length: 31 }, (_, i) => `w${i}`)));
    expect(collectionData).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledWith('__name__', 'in', expect.arrayContaining(['w0']));
    expect(where).not.toHaveBeenCalledWith('scheduledLocalDate', expect.anything(), expect.anything());
    expect(limit).toHaveBeenCalledWith(30);
  });
  it('propagates completion failures instead of converting failure to unlinked and avoids empty queries', async () => {
    await expect(firstValueFrom(service.watchWorkoutCompletionsForWorkouts('owner', []))).resolves.toEqual([]);
    expect(collectionData).not.toHaveBeenCalled();
    vi.mocked(collectionData).mockReturnValue(throwError(() => new Error('denied')));
    await expect(firstValueFrom(service.watchWorkoutCompletionsForWorkouts('owner', ['w1']))).rejects.toThrow('denied');
  });
});
