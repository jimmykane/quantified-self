import { describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { GenkitError, genkit, type GenerateResponseData } from 'genkit';
import { ValidationError } from 'genkit/schema';
import { HttpsError } from 'firebase-functions/v2/https';
import { assistantGenkit } from './model';
import { defaultDayWorkoutControls } from '../../../shared/day-workout';
import { DAY_WORKOUT_SYSTEM, generateDayWorkout, generateDayWorkoutSuggestion, runGenerateDayWorkout, type DayWorkoutDependencies } from './day-workout-callable';
import { runDailyWorkoutSuggestion } from './daily-workout-suggestion';
import { DayWorkoutSuggestionValidationError } from './day-workout-validation';
import type { AssistantQuotaReservation } from './quota';
vi.mock('../utils', () => ({ ALLOWED_CORS_ORIGINS: [], enforceAppCheck: (context: { app?: unknown }) => {
  if (!context.app) throw new Error('App Check required');
} }));
vi.mock('./model', () => ({ assistantGenkit: { generate: vi.fn() } }));
vi.mock('./mcp-session', () => ({ createAssistantMcpSession: vi.fn() }));
vi.mock('./daily-workout-suggestion', () => ({ runDailyWorkoutSuggestion: vi.fn() }));
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
function mockSdkOutputs(...outputs: (string | Error)[]) {
  const ai = genkit({});
  let attempt = 0;
  const provider = vi.fn(async (): Promise<GenerateResponseData> => {
    const output = outputs[attempt++];
    if (output instanceof Error) throw output;
    return { usage: { inputTokens: 123, outputTokens: 17, thoughtsTokens: 9 }, finishReason: 'stop' as const, message: { role: 'model' as const, content: [{ text: output }] } };
  });
  const model = ai.defineModel({ name: 'test/day-workout-output-correction' }, provider);
  const generate = vi.mocked(assistantGenkit.generate).mockReset();
  generate.mockImplementation(options => ai.generate({ ...options as object, model }) as never);
  return { provider, generate };
}
const request = { requestId: 'day-workout:71f1e982-b718-4c5b-a3c7-c45eebdefc84', controls: defaultDayWorkoutControls('2026-10-28', 'UTC') };
const auth = { auth: { uid: 'owner' }, app: {} };
describe('generateDayWorkout callable', () => {
  it('dispatches the first-party daily-suggestion mode through the existing callable', async () => {
    const input = { mode: 'daily-suggestion', action: 'status' };
    const status = { localDate: '2026-10-28', state: 'waiting' as const };
    vi.mocked(runDailyWorkoutSuggestion).mockResolvedValueOnce(status);
    const callableRequest = { data: input, ...auth };
    expect(await generateDayWorkout.run(callableRequest as Parameters<typeof generateDayWorkout.run>[0])).toEqual(status);
    expect(runDailyWorkoutSuggestion).toHaveBeenCalledExactlyOnceWith(input, callableRequest);
  });
  it('meters the real provider response before Genkit rejects malformed JSON', async () => {
    const evidence = await dependencies().context('owner', request, new Date());
    mockSdkOutputs('{"kind":'); const usage = vi.fn();
    await expect(generateDayWorkoutSuggestion(request, evidence, undefined, usage)).rejects.toBeInstanceOf(DayWorkoutSuggestionValidationError);
    expect(usage).toHaveBeenCalledWith({ available: true, inputTokens: 123, outputTokens: 17, thoughtsTokens: 9 });
  });
  it('keeps telemetry failures separate from successful model output', async () => {
    const evidence = await dependencies().context('owner', request, new Date());
    const { provider } = mockSdkOutputs(JSON.stringify({ kind: 'rest', rationale: 'Take it easy.' }));
    await expect(generateDayWorkoutSuggestion(request, evidence, undefined, () => { throw new SyntaxError('Telemetry failed'); }))
      .resolves.toEqual({ kind: 'rest', rationale: 'Take it easy.' });
    expect(provider).toHaveBeenCalledOnce();
  });
  it('flags invalid token metadata as unknown instead of measuring a zero-cost attempt', async () => {
    const evidence = await dependencies().context('owner', request, new Date());
    const { provider } = mockSdkOutputs('unused'); const usage = vi.fn();
    provider.mockResolvedValueOnce({ finishReason: 'stop', usage: { inputTokens: 100, outputTokens: -1, thoughtsTokens: 9 },
      message: { role: 'model', content: [{ text: JSON.stringify({ kind: 'rest', rationale: 'Take it easy.' }) }] } });
    await generateDayWorkoutSuggestion(request, evidence, undefined, usage);
    expect(usage).toHaveBeenCalledWith({ available: false, inputTokens: 100, outputTokens: 0, thoughtsTokens: 9 });
  });
  it.each(['plan', 'calendar'] as const)('honors an authored %s rest day without a model request or quota charge and replays it', async source => {
    const deps = dependencies();
    vi.mocked(deps.context).mockResolvedValue({ evidence: {}, usedContext: ['Authored rest day'], missingContext: [],
      previousStrength: [], references: [], plannedRestDay: { localDate: request.controls.localDate, planName: 'Autumn', source } });
    const response = await runGenerateDayWorkout({ ...request, controls: { ...request.controls, trainingContext: true } }, auth, deps);
    expect(response.kind).toBe('rest');
    expect(response.rationale).toContain(source === 'calendar' ? 'calendar rest day' : 'planned rest day in Autumn');
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.finalize).not.toHaveBeenCalled();
    expect(deps.release).toHaveBeenCalledTimes(1);
    vi.mocked(deps.store.begin).mockResolvedValue({ response });
    await expect(runGenerateDayWorkout(request, auth, deps)).resolves.toEqual(response);
    expect(deps.context).toHaveBeenCalledTimes(1);
  });
  it.each([ActivityTypes.Running, ActivityTypes.StrengthTraining])('constrains model output to the %s prescription schema', async sport => {
    vi.mocked(assistantGenkit.generate).mockResolvedValueOnce({ output: { kind: 'rest', rationale: 'Rest.' } } as never);
    const evidence = await dependencies().context('owner', request, new Date());
    await expect(generateDayWorkoutSuggestion({ ...request, controls: { ...request.controls, sport } }, evidence))
      .resolves.toEqual({ kind: 'rest', rationale: 'Rest.' });
    const input = vi.mocked(assistantGenkit.generate).mock.calls.at(-1)![0] as {
      output: { jsonSchema: { anyOf: { properties: Record<string, unknown>; additionalProperties: boolean }[] } };
    };
    const alternatives = input.output.jsonSchema.anyOf;
    expect(Object.keys(alternatives[0].properties)).toEqual(['kind', 'rationale']);
    expect(Object.keys(alternatives[1].properties)).toEqual(sport === ActivityTypes.Running
      ? ['kind', 'title', 'rationale', 'structure'] : ['kind', 'title', 'rationale', 'strength', 'estimatedMinutes']);
    expect(alternatives.every(value => value.additionalProperties === false)).toBe(true);
    expect(JSON.stringify(input.output.jsonSchema)).not.toContain('"maxItems":');
    expect(JSON.stringify(input.output.jsonSchema)).not.toContain('"pattern":');
  });
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
    expect(deps.generate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.generate).mock.calls[1][2]).toContain('Invalid explanation.');
    expect(deps.finalize).toHaveBeenCalledTimes(1);
    expect(deps.release).not.toHaveBeenCalled();
  });
  it.each(['schema', 'JSON syntax'])('corrects a strength reply rejected by real Genkit %s validation', async kind => {
    const deps = dependencies();
    const reply = { kind: 'workout', title: 'Bodyweight session', rationale: 'A gentle session.',
      strength: { version: 1, exercises: [{ id: 'squat', name: 'Bodyweight squat',
        sets: [{ id: 'set1', ending: { kind: 'repetitions', repetitions: 10 } }] }] } };
    const malformed = kind === 'schema' ? JSON.stringify({ ...reply,
      strength: { version: 1, exercises: [{ id: 'squat', name: 'Bodyweight squat',
        sets: [{ id: 'set1', ending: { kind: 'repetitions', reps: 10 } }] }] },
    }) : '{"kind":"workout","rationale":PRIVATE_MODEL_REPLY}';
    const { provider, generate } = mockSdkOutputs(malformed, JSON.stringify(reply));
    deps.generate = generateDayWorkoutSuggestion;
    const generationRequest = { ...request, controls: defaultDayWorkoutControls('2026-10-28', 'UTC', ActivityTypes.StrengthTraining) };
    try {
      const response = await runGenerateDayWorkout(generationRequest, auth, deps);
      expect(response.draft?.strength).toEqual(reply.strength);
      expect(provider).toHaveBeenCalledTimes(2);
      expect(JSON.parse((generate.mock.calls[1][0] as { prompt: string }).prompt).correction)
        .toContain('Invalid prescription schema.');
      expect(deps.finalize).toHaveBeenCalledTimes(1);
      expect(deps.release).not.toHaveBeenCalled();
      vi.mocked(deps.store.begin).mockResolvedValue({ response });
      await expect(runGenerateDayWorkout(generationRequest, auth, deps)).resolves.toEqual(response);
      expect(provider).toHaveBeenCalledTimes(2);
      expect(deps.finalize).toHaveBeenCalledTimes(1);
    } finally { generate.mockReset(); }
  });
  it.each(['schema', 'JSON syntax'])('stops after two %s failures without exposing raw output or charging twice', async kind => {
    const deps = dependencies();
    const malformed = kind === 'schema' ? JSON.stringify({ kind: 'rest', rationale: 'PRIVATE_MODEL_REPLY', PRIVATE_VALIDATION_DETAIL: true })
      : '{"kind":"rest","rationale":PRIVATE_MODEL_REPLY}';
    const { provider, generate } = mockSdkOutputs(malformed, malformed);
    deps.generate = generateDayWorkoutSuggestion;
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const failure = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      await expect(runGenerateDayWorkout(request, auth, deps)).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(provider).toHaveBeenCalledTimes(2);
      expect(deps.finalize).toHaveBeenCalledTimes(1);
      expect(deps.release).not.toHaveBeenCalled();
      expect(deps.store.finish).toHaveBeenCalledWith('owner', request.requestId, 'lease', null);
      const diagnostics = JSON.stringify([warning.mock.calls, failure.mock.calls, generate.mock.calls]);
      expect(diagnostics).not.toContain('PRIVATE_MODEL_REPLY');
      expect(diagnostics).not.toContain('PRIVATE_VALIDATION_DETAIL');
    } finally { warning.mockRestore(); failure.mockRestore(); generate.mockReset(); }
  });
  it.each([
    { kind: 'request schema', error: new ValidationError({ data: null, schema: {}, errors: [] }) },
    { kind: 'provider parsing', error: new SyntaxError('PRIVATE_PROVIDER_RESPONSE') },
  ])('does not correct $kind failures before the provider returns a response', async ({ error }) => {
    const deps = dependencies();
    const { provider, generate } = mockSdkOutputs(error, JSON.stringify({ kind: 'rest', rationale: 'Rest.' }));
    deps.generate = generateDayWorkoutSuggestion;
    try {
      await expect(runGenerateDayWorkout(request, auth, deps)).rejects.toMatchObject({ code: 'unavailable' });
      expect(provider).toHaveBeenCalledTimes(1);
      expect(deps.finalize).toHaveBeenCalledTimes(1);
      expect(deps.release).not.toHaveBeenCalled();
    } finally { generate.mockReset(); }
  });
  it('shares one correction budget across JSON parsing and canonical prescription failures', async () => {
    const deps = dependencies();
    const { provider, generate } = mockSdkOutputs('{"kind":"rest","rationale":INVALID}',
      JSON.stringify({ kind: 'rest', rationale: '' }));
    deps.generate = generateDayWorkoutSuggestion;
    try {
      await expect(runGenerateDayWorkout(request, auth, deps)).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(provider).toHaveBeenCalledTimes(2);
      expect(deps.finalize).toHaveBeenCalledTimes(1);
      expect(deps.release).not.toHaveBeenCalled();
    } finally { generate.mockReset(); }
  });
  it('does not retry a safety-blocked model response or log its private reason', async () => {
    const deps = dependencies();
    const { provider, generate } = mockSdkOutputs();
    provider.mockResolvedValueOnce({ finishReason: 'blocked', finishMessage: 'PRIVATE_BLOCK_REASON' });
    deps.generate = generateDayWorkoutSuggestion;
    const failure = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      await expect(runGenerateDayWorkout(request, auth, deps)).rejects.toMatchObject({ code: 'unavailable' });
      expect(provider).toHaveBeenCalledTimes(1);
      expect(deps.finalize).toHaveBeenCalledTimes(1);
      expect(deps.release).not.toHaveBeenCalled();
      expect(JSON.stringify(failure.mock.calls)).not.toContain('PRIVATE_BLOCK_REASON');
    } finally { failure.mockRestore(); generate.mockReset(); }
  });
  it.each(['UNAVAILABLE', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'INVALID_ARGUMENT'] as const)(
    'does not treat a provider %s failure as correctable model output', async status => {
      const deps = dependencies();
      vi.mocked(deps.generate).mockRejectedValue(new GenkitError({ status, message: 'Schema validation failed.' }));
      await expect(runGenerateDayWorkout(request, auth, deps)).rejects.toMatchObject({ code: 'unavailable' });
      expect(deps.generate).toHaveBeenCalledTimes(1);
      expect(deps.finalize).toHaveBeenCalledTimes(1);
      expect(deps.release).not.toHaveBeenCalled();
    });
  it('rechecks the request lease before correcting a rejected schema', async () => {
    const deps = dependencies();
    vi.mocked(deps.generate).mockRejectedValueOnce(new DayWorkoutSuggestionValidationError('Invalid prescription schema.'));
    vi.mocked(deps.store.assertActive).mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new HttpsError('aborted', 'Draft replaced.'));
    await expect(runGenerateDayWorkout(request, auth, deps)).rejects.toMatchObject({ code: 'aborted' });
    expect(deps.generate).toHaveBeenCalledTimes(1);
    expect(deps.finalize).toHaveBeenCalledTimes(1);
  });
  it.each([ActivityTypes.Running, ActivityTypes.StrengthTraining])('still corrects canonical %s prescription failures', async sport => {
    const deps = dependencies();
    vi.mocked(deps.generate).mockResolvedValueOnce({ kind: 'workout', title: 'Session', rationale: 'A gentle session.',
      ...(sport === ActivityTypes.Running ? { structure: { version: 1, sport, nodes: [] } }
        : { strength: { version: 1, exercises: [] } }) });
    await expect(runGenerateDayWorkout({ ...request, controls: defaultDayWorkoutControls('2026-10-28', 'UTC', sport) }, auth, deps))
      .resolves.toMatchObject({ kind: 'rest' });
    expect(deps.generate).toHaveBeenCalledTimes(2);
    expect(deps.finalize).toHaveBeenCalledTimes(1);
  });
  it('logs the failure stage without private evidence or raw model errors', async () => {
    const deps = dependencies();
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.mocked(deps.generate).mockRejectedValueOnce(new Error('private response and health evidence'));
    await expect(runGenerateDayWorkout(request, auth, deps)).rejects.toThrow(/generation/);
    expect(log).toHaveBeenCalledWith('[DayWorkout] Generation failed.', {
      stage: 'model', billable: true, errorName: 'Error', errorStatus: 'unknown',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private response');
    log.mockRestore();
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
