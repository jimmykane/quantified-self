import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), appCheck: vi.fn() }));
vi.mock('firebase-functions/v2/https', async () => ({ ...(await vi.importActual<object>('firebase-functions/v2/https')),
  onCall: (_options: unknown, handler: unknown) => handler }));
vi.mock('../utils', () => ({ enforceAppCheck: mocks.appCheck, ALLOWED_CORS_ORIGINS: ['https://localhost:4200'] }));
vi.mock('./read', () => ({ readTrainingGoalsProgress: mocks.read }));
import { getTrainingGoalsProgress } from './callable';
const call = getTrainingGoalsProgress as unknown as (request: unknown) => Promise<unknown>;
beforeEach(() => { vi.clearAllMocks(); mocks.appCheck.mockImplementation(() => undefined); });
describe('goal progress callable', () => {
  it('requires authentication and App Check', async () => {
    await expect(call({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
    mocks.appCheck.mockImplementation(() => { throw Error('App Check'); });
    await expect(call({ auth: { uid: 'owner' }, data: {} })).rejects.toThrow('App Check');
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('rejects identity injection and invalid timezone input', async () => {
    for (const data of [{ uid: 'other', localDate: '2026-11-03', timeZone: 'UTC' }, { localDate: '2026-11-03', timeZone: 'invented' }]) {
      await expect(call({ auth: { uid: 'owner' }, data })).rejects.toMatchObject({ code: 'invalid-argument' });
    }
  });
  it('returns only batched progress for the authenticated owner', async () => {
    mocks.read.mockResolvedValue({ revision: 2, progress: [], weekStartsOn: 1, complete: true, goals: [{ private: true }] });
    const data = { localDate: '2026-11-03', timeZone: 'UTC' };
    expect(await call({ auth: { uid: 'owner' }, data })).toEqual({ goalsRevision: 2, progress: [], weekStartsOn: 1, complete: true });
    expect(mocks.read).toHaveBeenCalledWith('owner', data);
  });
});
