import { ActivityTypes } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    enforceAppCheck: vi.fn(),
    mutate: vi.fn(),
    place: vi.fn(),
    loggerError: vi.fn(),
}));
vi.mock('firebase-functions/v2/https', () => ({
    HttpsError: class MockHttpsError extends Error {
        constructor(public readonly code: string, message: string) { super(message); }
    },
    onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/logger', () => ({ error: hoisted.loggerError }));
vi.mock('../../../shared/functions-manifest', () => ({ FUNCTIONS_MANIFEST: {
    mutateWorkoutLibrary: { region: 'europe-west2' }, placeWorkoutLibrary: { region: 'europe-west2' },
} }));
vi.mock('../utils', () => ({ enforceAppCheck: hoisted.enforceAppCheck }));
vi.mock('./workout-library', () => ({ mutateWorkoutLibraryForUser: hoisted.mutate,
    placeWorkoutLibraryForUser: hoisted.place }));

import { mutateWorkoutLibrary, placeWorkoutLibrary } from './workout-library-callables';

const structure = { version: 1, sport: ActivityTypes.Running, nodes: [{ id: 'step', kind: 'step',
    purpose: 'work', ending: { kind: 'time', seconds: 1800 }, targets: [] }] };
const create = { mutationId: 'create-1', operation: { kind: 'create', itemId: 'saved-1',
    title: 'Easy run', structure } };
const place = { mutationId: 'place-1', itemId: 'saved-1', expectedTemplateRevision: 1,
    expectedStateRevision: 0, planId: null, expectedPlanRevision: null,
    dates: ['2026-10-01'], confirmPlanRangeExtension: false };
const invoke = (handler: unknown, data: unknown, uid = 'owner') =>
    (handler as (request: unknown) => Promise<unknown>)({ auth: { uid }, data });

describe('workout library callables', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.mutate.mockResolvedValue({ mutationId: 'create-1', item: null });
        hoisted.place.mockResolvedValue({ mutationId: 'place-1', workoutIds: ['new-1'],
            dates: ['2026-10-01'], stateRevision: 1, planRevision: null });
    });

    it.each([mutateWorkoutLibrary, placeWorkoutLibrary])('requires Auth and App Check', async handler => {
        await expect((handler as never as (request: unknown) => Promise<unknown>)({ data: {} }))
            .rejects.toMatchObject({ code: 'unauthenticated' });
        hoisted.enforceAppCheck.mockImplementationOnce(() => { throw new Error('App Check failed'); });
        await expect(invoke(handler, {})).rejects.toThrow('App Check failed');
        expect(hoisted.mutate).not.toHaveBeenCalled();
        expect(hoisted.place).not.toHaveBeenCalled();
    });

    it('rejects unknown fields and scopes mutations to the authenticated user', async () => {
        await expect(invoke(mutateWorkoutLibrary, { ...create, uid: 'other' }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        await invoke(mutateWorkoutLibrary, create);
        expect(hoisted.mutate).toHaveBeenCalledWith('owner', expect.objectContaining({
            operation: expect.objectContaining({ itemId: 'saved-1' }),
        }));
        await invoke(placeWorkoutLibrary, place);
        expect(hoisted.place).toHaveBeenCalledWith('owner', expect.objectContaining({
            itemId: 'saved-1', dates: ['2026-10-01'],
        }));
    });
});
