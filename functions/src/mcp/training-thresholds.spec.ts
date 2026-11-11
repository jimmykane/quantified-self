import { describe, expect, it } from 'vitest';
import { applyTrainingThresholdChanges } from '../../../shared/training-thresholds';
import { TRAINING_THRESHOLD_INPUTS, TRAINING_THRESHOLD_OUTPUTS } from './training-thresholds.schemas';
import { trainingThresholdChanges } from './training-thresholds.service';
import { requiredScopesForRequest } from './server';
import { hasValidMcpScopeDependencies, MCP_OAUTH_SCOPES } from './oauth.service';

describe('MCP training thresholds', () => {
  it('accepts explicit running pace units and preserves unrelated thresholds', () => {
    expect(trainingThresholdChanges({ runningPace: { paceSeconds: 270, distanceUnit: 'km' } }))
      .toEqual({ runningThresholdSpeed: 1000 / 270 });
    expect(trainingThresholdChanges({ runningPace: { paceSeconds: 480, distanceUnit: 'mi' } }).runningThresholdSpeed)
      .toBeCloseTo(1609.34 / 480, 12);
    expect(trainingThresholdChanges({ runningPace: null })).toEqual({ runningThresholdSpeed: null });
    const policy = { method: 'HR' as const, included: true, runningThresholdSpeed: 3.7, functionalThresholdPower: 220 };
    expect(applyTrainingThresholdChanges('running', policy, { lactateThresholdHR: 165 }))
      .toEqual({ ...policy, lactateThresholdHR: 165 });
    expect(() => applyTrainingThresholdChanges('walking-hiking', { method: 'HR', included: true }, { runningThresholdSpeed: 3.7 })).toThrow();
    const request = { policyRef: 'opaque', mutationId: '123e4567-e89b-42d3-a456-426614174000', changes: {} };
    for (const runningPace of [{ paceSeconds: 270, distanceUnit: 'm' }, { paceSeconds: 0, distanceUnit: 'km' },
      { paceSeconds: 270, distanceUnit: 'km', uid: 'foreign' }])
      expect(TRAINING_THRESHOLD_INPUTS.preview_training_threshold_change.safeParse({ ...request, changes: { runningPace } }).success).toBe(false);
  });
  it('uses explicit metric/imperial CSS units and independent FTP/HR values', () => {
    expect(trainingThresholdChanges({ css: { paceSeconds: 113, distanceUnit: 'yd' }, lactateThresholdHR: 165 }))
      .toEqual({ swimThresholdSpeed: 91.44 / 113, lactateThresholdHR: 165 });
    expect(trainingThresholdChanges({ css: { paceSeconds: 113, distanceUnit: 'm' } }))
      .toEqual({ swimThresholdSpeed: 100 / 113 });
    expect(trainingThresholdChanges({ css: null })).toEqual({ swimThresholdSpeed: null });
  });
  it('changes only requested thresholds and preserves method, inclusion and other calibration', () => {
    const current = { method: 'MET' as const, included: false, functionalThresholdPower: 220, lactateThresholdHR: 165 };
    expect(applyTrainingThresholdChanges('cycling', current, { functionalThresholdPower: 230 }))
      .toEqual({ ...current, functionalThresholdPower: 230 });
    expect(applyTrainingThresholdChanges('cycling', current, { lactateThresholdHR: null }))
      .toEqual({ method: 'MET', included: false, functionalThresholdPower: 220 });
    expect(() => applyTrainingThresholdChanges('swimming', { method: 'HR', included: true }, { functionalThresholdPower: 220 })).toThrow();
    expect(() => applyTrainingThresholdChanges('cycling', current, { method: 'HR' } as never)).toThrow();
  });
  it('keeps thresholds separate from Health/measurement and plan grants', () => {
    for (const name of ['get_training_thresholds', 'preview_training_threshold_change', 'apply_training_threshold_change'])
      expect(requiredScopesForRequest({ method: 'tools/call', params: { name } })).toEqual([
        MCP_OAUTH_SCOPES.TrainingThresholdsRead, ...(name === 'get_training_thresholds' ? [] : [MCP_OAUTH_SCOPES.TrainingThresholdsWrite]),
      ]);
    expect(hasValidMcpScopeDependencies([MCP_OAUTH_SCOPES.TrainingThresholdsWrite])).toBe(false);
    expect(hasValidMcpScopeDependencies([MCP_OAUTH_SCOPES.TrainingThresholdsRead, MCP_OAUTH_SCOPES.TrainingThresholdsWrite])).toBe(true);
  });
  it('rejects identity injection, backdating and generic policy/Health writes', () => {
    const request = { policyRef: 'opaque-current-policy', mutationId: '123e4567-e89b-42d3-a456-426614174000', changes: { lactateThresholdHR: 165 } };
    expect(TRAINING_THRESHOLD_INPUTS.preview_training_threshold_change.safeParse(request).success).toBe(true);
    for (const extra of [{ uid: 'foreign' }, { effectiveAt: '2020-01-01T00:00:00Z' }, { expectedRevision: 99 }])
      expect(TRAINING_THRESHOLD_INPUTS.preview_training_threshold_change.safeParse({ ...request, ...extra }).success).toBe(false);
    for (const changes of [{}, { weight: 70 }, { included: false }, { lactateThresholdHR: Infinity }])
      expect(TRAINING_THRESHOLD_INPUTS.preview_training_threshold_change.safeParse({ ...request, changes }).success).toBe(false);
    expect(TRAINING_THRESHOLD_OUTPUTS.get_training_thresholds.safeParse({ asOf: '2026-11-04T00:00:00Z', policies: [],
      rawPolicy: { private: true } }).success).toBe(false);
  });
});
