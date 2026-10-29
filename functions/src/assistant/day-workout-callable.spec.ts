import { describe, expect, it, vi } from 'vitest';
import { defaultDayWorkoutControls } from '../../../shared/day-workout';
import { DAY_WORKOUT_SYSTEM, runGenerateDayWorkout, type DayWorkoutDependencies } from './day-workout-callable';
import type { AssistantQuotaReservation } from './quota';
vi.mock('../utils', () => ({ ALLOWED_CORS_ORIGINS: [], enforceAppCheck: (context: { app?: unknown }) => {
  if (!context.app) throw new Error('App Check required');
} }));
vi.mock('./model', () => ({ assistantGenkit: { generate: vi.fn() } }));
vi.mock('./mcp-session', () => ({ createAssistantMcpSession: vi.fn() }));
vi.mock('./quota', () => ({ reserveAssistantQuotaForRequest: vi.fn(), finalizeAssistantQuotaReservation: vi.fn(), releaseAssistantQuotaReservation: vi.fn() }));
function dependencies(): DayWorkoutDependencies {
  return { now: () => new Date('2026-10-28T12:00:00Z'), legal: vi.fn().mockResolvedValue(undefined),
    store: { begin: vi.fn().mockResolvedValue({ token: 'lease' }), assertActive: vi.fn().mockResolvedValue(undefined), finish: vi.fn().mockResolvedValue(undefined) },
    reserve: vi.fn().mockResolvedValue({ reservationID: 'quota' } as AssistantQuotaReservation),
    finalize: vi.fn().mockResolvedValue({}), release: vi.fn().mockResolvedValue({}),
    context: vi.fn().mockResolvedValue({ evidence: {}, usedContext: [], missingContext: [], previousStrength: [], references: [] }),
    generate: vi.fn().mockResolvedValue({ kind: 'rest', rationale: 'Take a recovery day.' }),
  };
}
const request = { requestId: 'request-1234', controls: defaultDayWorkoutControls('2026-10-28', 'UTC') };
const auth = { auth: { uid: 'owner' }, app: {} };
describe('generateDayWorkout callable', () => {
  it('instructs generation to use automatic recovery evidence without treating missing or future signals as known', () => {
    for (const signal of ['freshness (Form)', 'ramp rate', 'sleep duration/quality', 'HRV personalRange',
      'overnightHeartRate', 'readiness score/confidence', 'activities already completed today']) {
      expect(DAY_WORKOUT_SYSTEM).toContain(signal);
    }
    expect(DAY_WORKOUT_SYSTEM).toContain('even when optional Training-plan or Timeline context is off');
    expect(DAY_WORKOUT_SYSTEM).toContain('never assume higher is always better');
    expect(DAY_WORKOUT_SYSTEM).toContain('time budget, not a requirement to fill it');
    expect(DAY_WORKOUT_SYSTEM).toContain('conditional on rechecking recovery');
    expect(DAY_WORKOUT_SYSTEM).toContain('do not claim an unavailable signal');
  });
  it('checks authentication, App Check and legal acceptance before any context/model call', async () => {
    const deps = dependencies();
    await expect(runGenerateDayWorkout(request, {}, deps)).rejects.toThrow(/Sign in/);
    await expect(runGenerateDayWorkout(request, { auth: auth.auth }, deps)).rejects.toThrow(/App Check/);
    vi.mocked(deps.legal).mockRejectedValue(new Error('Legal acceptance missing'));
    await expect(runGenerateDayWorkout(request, auth, deps)).rejects.toThrow(/Legal/);
    expect(deps.store.begin).not.toHaveBeenCalled(); expect(deps.generate).not.toHaveBeenCalled();
  });
  it('replays an existing result without another quota reservation or model request', async () => {
    const deps = dependencies();
    const response = await runGenerateDayWorkout(request, auth, deps);
    vi.mocked(deps.store.begin).mockResolvedValue({ response });
    await expect(runGenerateDayWorkout(request, auth, deps)).resolves.toEqual(response);
    expect(deps.reserve).toHaveBeenCalledTimes(1); expect(deps.generate).toHaveBeenCalledTimes(1);
    expect(deps.finalize).toHaveBeenCalledTimes(1); expect(deps.release).not.toHaveBeenCalled();
  });
  it('releases unspent quota on failed context and never invokes the model', async () => {
    const deps = dependencies(); vi.mocked(deps.context).mockRejectedValue(new Error('Schedule failed'));
    await expect(runGenerateDayWorkout(request, auth, deps)).rejects.toThrow(/context/);
    expect(deps.release).toHaveBeenCalledTimes(1); expect(deps.finalize).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
  });
  it('permits only one bounded correction and charges model failures once', async () => {
    const deps = dependencies(); vi.mocked(deps.generate).mockResolvedValue({ kind: 'invalid' });
    await expect(runGenerateDayWorkout(request, auth, deps)).rejects.toThrow(/valid prescription/);
    expect(deps.generate).toHaveBeenCalledTimes(2); expect(deps.finalize).toHaveBeenCalledTimes(1);
    expect(deps.release).not.toHaveBeenCalled();
  });
  it('releases an unused reservation if quota finalization fails before the model starts', async () => {
    const deps = dependencies(); vi.mocked(deps.finalize).mockRejectedValue(new Error('Quota write failed'));
    await expect(runGenerateDayWorkout(request, auth, deps)).rejects.toThrow();
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.finalize).toHaveBeenCalledTimes(1);
    expect(deps.release).toHaveBeenCalledWith({ reservationID: 'quota' });
    expect(deps.store.finish).toHaveBeenCalledWith('owner', request.requestId, 'lease', null);
  });
  it('counts separate generations and failed model attempts, but not a rejected quota reservation', async () => {
    const deps = dependencies();
    await runGenerateDayWorkout(request, auth, deps);
    vi.mocked(deps.generate).mockRejectedValueOnce(new Error('Model unavailable'));
    await expect(runGenerateDayWorkout({ ...request, requestId: 'new-request-1234' }, auth, deps)).rejects.toThrow();
    expect(deps.finalize).toHaveBeenCalledTimes(2);
    expect(deps.release).not.toHaveBeenCalled();
    vi.mocked(deps.reserve).mockRejectedValueOnce(new Error('Quota exhausted'));
    await expect(runGenerateDayWorkout({ ...request, requestId: 'blocked-request' }, auth, deps)).rejects.toThrow();
    expect(deps.generate).toHaveBeenCalledTimes(2);
    expect(deps.finalize).toHaveBeenCalledTimes(2);
  });
});
