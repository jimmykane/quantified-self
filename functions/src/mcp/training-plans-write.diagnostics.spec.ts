import { beforeEach, describe, expect, it, vi } from 'vitest';

const logging = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => logging);

import { emitTrainingApplyDiagnostic, type TrainingApplyTiming } from './training-plans-write.service';

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

    expect(logging.info).toHaveBeenCalledWith('[MCP] Training apply completed', {
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
});
