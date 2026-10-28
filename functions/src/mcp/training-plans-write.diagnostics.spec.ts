import { beforeEach, describe, expect, it, vi } from 'vitest';

const logging = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => logging);

import { applyTrainingChanges, emitTrainingApplyDiagnostic, type TrainingApplyTiming,
  type TrainingWriteDependencies } from './training-plans-write.service';

function timing(overrides: Partial<TrainingApplyTiming> = {}): TrainingApplyTiming {
  return {
    operationCount: 4,
    scheduleOperationCount: 3,
    providerOperationCount: 1,
    proposalMs: 101.4,
    scheduleMs: 2_500.2,
    providerMs: 300.1,
    finalizeMs: 98.8,
    outcome: 'applied',
    ...overrides,
  };
}

describe('Training MCP apply diagnostics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emits one privacy-safe completion diagnostic without authored or account data', () => {
    emitTrainingApplyDiagnostic(timing(), 3_000.4);

    expect(logging.info).toHaveBeenCalledWith('[MCP] Training apply finished', {
      operationCount: 4,
      scheduleOperationCount: 3,
      providerOperationCount: 1,
      durationMs: 3000,
      stageDurationMs: { proposal: 101, schedule: 2500, provider: 300, finalize: 99 },
      outcome: 'applied',
      slowStage: 'schedule',
    });
    expect(logging.warn).not.toHaveBeenCalled();
    expect(JSON.stringify(logging.info.mock.calls)).not.toMatch(/uid|title|note|reference|proposalRef|workoutId|planId/i);
  });

  it('warns once when total apply time reaches five seconds', () => {
    emitTrainingApplyDiagnostic(timing({ outcome: 'partially_applied' }), 5_000);

    expect(logging.info).toHaveBeenCalledTimes(1);
    expect(logging.warn).toHaveBeenCalledTimes(1);
    expect(logging.warn).toHaveBeenCalledWith('[MCP] Training apply slow', expect.objectContaining({
      durationMs: 5000,
      outcome: 'partially_applied',
      slowStage: 'schedule',
    }));
  });

  it('attributes an early rejected request to proposal processing', async () => {
    const monotonicNow = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(260);
    const deps = {
      db: {} as TrainingWriteDependencies['db'],
      runtime: {} as TrainingWriteDependencies['runtime'],
      now: () => 1,
      randomId: () => 'unused',
      monotonicNow,
    } satisfies TrainingWriteDependencies;

    await expect(applyTrainingChanges({
      uid: 'user',
      connectionId: 'connection',
      scopes: [],
      arguments: {},
    }, deps)).rejects.toThrow('valid Training proposal reference');

    expect(logging.info).toHaveBeenCalledWith('[MCP] Training apply finished', expect.objectContaining({
      durationMs: 160,
      stageDurationMs: { proposal: 160, schedule: 0, provider: 0, finalize: 0 },
      outcome: 'failed',
      slowStage: 'proposal',
    }));
  });
});
