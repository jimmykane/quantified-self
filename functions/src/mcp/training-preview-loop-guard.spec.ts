import { describe, expect, it, vi } from 'vitest';
import {
  buildTrainingPreviewLoopGuardBucketId,
  consumeInvalidTrainingPreviewAttempt,
  invalidTrainingPreviewTool,
  type TrainingPreviewLoopGuardDependencies,
} from './training-preview-loop-guard';

const validStructure = {
  version: 1,
  sport: 'Running',
  nodes: [{
    kind: 'step', id: 'easy', purpose: 'work',
    ending: { kind: 'time', seconds: 1800 }, targets: [],
  }],
};

describe('Training preview loop guard', () => {
  it('recognizes only malformed Training preview calls', () => {
    expect(invalidTrainingPreviewTool({ method: 'tools/call', params: {
      name: 'preview_training_changes',
      arguments: { expectedScheduleRevision: 1, changes: [{ kind: 'invented' }] },
    } })).toBe('preview_training_changes');
    expect(invalidTrainingPreviewTool({ method: 'tools/call', params: {
      name: 'preview_create_planned_workout',
      arguments: { expectedScheduleRevision: 1 },
    } })).toBe('preview_create_planned_workout');
    expect(invalidTrainingPreviewTool({ method: 'tools/call', params: {
      name: 'preview_create_planned_workout',
      arguments: {
        expectedScheduleRevision: 1,
        localDate: '2026-09-19',
        title: 'Easy run',
        structure: validStructure,
        delivery: { providers: ['garmin'], timeZone: 'Europe/Helsinki' },
      },
    } })).toBeNull();
    expect(invalidTrainingPreviewTool({ method: 'tools/call', params: {
      name: 'query_planned_workouts', arguments: {},
    } })).toBeNull();
  });

  it('uses opaque stable bucket IDs without exposing owner or connection values', () => {
    const id = buildTrainingPreviewLoopGuardBucketId(
      'connection', 'private-user', 'private-connection',
    );
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(id).not.toContain('private');
    expect(id).toBe(buildTrainingPreviewLoopGuardBucketId(
      'connection', 'private-user', 'private-connection',
    ));
  });

  it('permits three malformed attempts and rejects the fourth in one minute', async () => {
    const documents = new Map<string, Record<string, unknown>>();
    const runTransaction: TrainingPreviewLoopGuardDependencies['runTransaction'] = async operation => operation({
      get: async (reference: string) => ({
        exists: documents.has(reference),
        data: () => documents.get(reference),
      }),
      set: (reference: string, value: Record<string, unknown>) => documents.set(reference, value),
      assertUserAvailable: vi.fn().mockResolvedValue(undefined),
    });
    const dependencies = {
      now: () => 125_000,
      document: (id: string) => id,
      runTransaction,
      timestampFromMillis: (value: number) => value,
    };

    await consumeInvalidTrainingPreviewAttempt('user', 'connection', dependencies);
    await consumeInvalidTrainingPreviewAttempt('user', 'connection', dependencies);
    await consumeInvalidTrainingPreviewAttempt('user', 'connection', dependencies);
    await expect(consumeInvalidTrainingPreviewAttempt('user', 'connection', dependencies))
      .rejects.toMatchObject({
        name: 'McpTrainingPreviewLoopGuardError',
        blockedForSeconds: 600,
      });
    expect([...documents.values()]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        uid: 'user',
        connectionId: 'connection',
        rateLimitType: 'training_preview_validation',
        count: 3,
        blockedUntilMs: 725_000,
      }),
      expect.objectContaining({
        uid: 'user',
        rateLimitType: 'training_preview_validation',
        count: 4,
        blockedUntilMs: 0,
      }),
    ]));

    await expect(consumeInvalidTrainingPreviewAttempt('user', 'connection', {
      ...dependencies,
      now: () => 130_000,
    })).rejects.toMatchObject({ blockedForSeconds: 595 });
  });
});
