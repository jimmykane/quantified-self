import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes, DataDistance, DataDuration } from '@sports-alliance/sports-lib';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), importing: vi.fn() }));
vi.mock('../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: mocks.guard }));
vi.mock('../assistant/daily-workout-suggestion-store', () => ({ readDailyWorkoutHistoryImportActive: mocks.importing }));
import { readTrainingGoalsProgress } from './read';
const goal = { schemaVersion: 1, id: 'goal', name: 'Run', kind: 'ongoing', lifecycle: 'active', priority: 'normal',
  startLocalDate: '2026-11-01', targetLocalDate: null, sportScope: 'sport', sport: ActivityTypes.Running,
  objective: '', planId: null, weeklyTarget: { kind: 'workouts', value: 3 }, revision: 1, createdAtMs: 1, updatedAtMs: 1 };
const document = (id: string, data: Record<string, unknown>, exists = true) => ({ id, exists, data: () => data,
  get: (key: string) => data[key] });
function database(options: { parent?: Record<string, unknown>; missingParent?: boolean; noGoals?: boolean; missingDistance?: boolean; startLocalDate?: string } = {}) {
  const masks: unknown[][] = [];
  const reference = (path: string): object => ({ path, collection: (name: string) => reference(`${path}/${name}`),
    doc: (name: string) => reference(`${path}/${name}`), select: (...fields: unknown[]) => { masks.push(fields); return reference(path); },
    limit: () => reference(path), orderBy: () => reference(path), where: () => reference(path) });
  const get = vi.fn(async (ref: { path: string }) => {
    if (ref.path.endsWith('trainingGoalState/current')) return document('current', { revision: 1 });
    if (ref.path.endsWith('config/settings')) return document('settings', { 'unitSettings.startOfTheWeek': 1 });
    if (ref.path.endsWith('trainingGoals')) return { size: options.noGoals ? 0 : 1, docs: options.noGoals ? [] : [document('goal',
      { ...goal, startLocalDate: options.startLocalDate ?? goal.startLocalDate,
        weeklyTarget: options.missingDistance ? { kind: 'distance', value: 10000 } : goal.weeklyTarget })] };
    if (ref.path.endsWith('activities')) return { size: 1, docs: [document('activity', { eventID: 'event',
      eventStartDate: new Date('2026-11-02T08:00Z'), type: ActivityTypes.Running,
      stats: { [DataDuration.type]: 1800, ...(!options.missingDistance ? { [DataDistance.type]: 5000 } : {}) } })] };
    throw Error(ref.path);
  });
  const getAll = vi.fn(async () => [document('event', options.parent ?? {}, !options.missingParent)]);
  const db = { collection: (path: string) => reference(path), doc: (path: string) => reference(path),
    runTransaction: (run: (tx: unknown) => unknown) => run({ get, getAll }) };
  return { db: db as unknown as FirebaseFirestore.Firestore, get, getAll, masks };
}
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ shouldSkip: false }); mocks.importing.mockResolvedValue(false); });
describe('batched goal progress reads', () => {
  const request = { localDate: '2026-11-03', timeZone: 'Europe/Athens' };
  it('reads only canonical summary fields and counts a recording once', async () => {
    const test = database();
    const result = await readTrainingGoalsProgress('owner', request, test.db);
    expect(result.progress[0]).toMatchObject({ value: 1, target: 3, complete: true });
    expect(test.masks.some(fields => fields.includes('eventID') && fields.includes('type'))).toBe(true);
    expect(JSON.stringify(test.masks)).not.toMatch(/streams|creator|location|description/);
    expect(test.getAll.mock.calls[0].at(-1)).toEqual({ fieldMask: ['mergeType', 'isMerge'] });
  });
  it('excludes benchmark copies', async () => {
    expect((await readTrainingGoalsProgress('owner', request, database({ parent: { isMerge: true } }).db)).progress[0].value).toBe(0);
  });
  it('keeps actual multisport recordings', async () => {
    expect((await readTrainingGoalsProgress('owner', request, database({ parent: { isMerge: true, mergeType: 'multi' } }).db)).progress[0].value).toBe(1);
  });
  it('marks missing parents and active imports incomplete', async () => {
    expect((await readTrainingGoalsProgress('owner', request, database({ missingParent: true }).db)).progress[0].complete).toBe(false);
    mocks.importing.mockResolvedValue(true);
    const importing = database();
    expect((await readTrainingGoalsProgress('owner', request, importing.db)).progress[0].complete).toBe(false);
    expect(importing.get.mock.calls.some(([ref]) => ref.path.endsWith('activities'))).toBe(false);
  });
  it('does not query activity history when no weekly targets exist', async () => {
    const test = database({ noGoals: true });
    expect((await readTrainingGoalsProgress('owner', request, test.db)).progress).toEqual([]);
    expect(test.get.mock.calls.some(([ref]) => ref.path.endsWith('activities'))).toBe(false);
  });
  it('marks the whole progress response incomplete when a required activity metric is missing', async () => {
    const result = await readTrainingGoalsProgress('owner', request, database({ missingDistance: true }).db);
    expect(result.complete).toBe(false);
    expect(result.progress[0]).toMatchObject({ complete: false, met: false, kind: 'distance' });
  });
  it('does not read activities or import state before a weekly goal starts', async () => {
    const test = database({ startLocalDate: '2026-11-05' });
    const result = await readTrainingGoalsProgress('owner', request, test.db);
    expect(result.progress).toEqual([]);
    expect(result.goals).toHaveLength(1);
    expect(test.get.mock.calls.some(([ref]) => ref.path.endsWith('activities'))).toBe(false);
    expect(mocks.importing).not.toHaveBeenCalled();
  });
  it('fails closed for deleted accounts and invalid time zones', async () => {
    mocks.guard.mockResolvedValue({ shouldSkip: true });
    await expect(readTrainingGoalsProgress('owner', request, database().db)).rejects.toThrow('unavailable');
    await expect(readTrainingGoalsProgress('owner', { ...request, timeZone: 'invalid' }, database().db)).rejects.toThrow();
  });
});
