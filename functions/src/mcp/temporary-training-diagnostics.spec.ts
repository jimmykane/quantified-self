import { describe, expect, it } from 'vitest';
import {
  buildTemporaryTrainingRequestDiagnostic,
  TEMPORARY_TRAINING_DIAGNOSTICS_EXPIRES_AT_MS,
} from './temporary-training-diagnostics';

const now = TEMPORARY_TRAINING_DIAGNOSTICS_EXPIRES_AT_MS - 1;

describe('temporary Training request diagnostics', () => {
  it('reports focused preview shape without recording authored values', () => {
    const diagnostic = buildTemporaryTrainingRequestDiagnostic({
      method: 'tools/call',
      params: {
        name: 'preview_create_planned_workout',
        arguments: {
          expectedScheduleRevision: 4,
          localDate: '2026-09-19',
          title: 'Private title',
          structure: {
            version: 1,
            sport: 'Running',
            nodes: [{ kind: 'step', note: 'Private note' }],
          },
        },
      },
    }, now);

    expect(diagnostic).toMatchObject({
      toolName: 'preview_create_planned_workout',
      inputValid: false,
      presentFields: ['expectedScheduleRevision', 'localDate', 'structure', 'title'],
      structureFields: ['nodes', 'sport', 'version'],
      nodeCount: 1,
      firstNodeShape: 'object',
      firstNodeKind: 'step',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('Private');
    expect(JSON.stringify(diagnostic)).not.toContain('2026-09-19');
    expect(JSON.stringify(diagnostic)).not.toContain('Running');
  });

  it('classifies a safe batch kind alias and reports field presence only', () => {
    const diagnostic = buildTemporaryTrainingRequestDiagnostic({
      method: 'tools/call',
      params: {
        name: 'preview_training_changes',
        arguments: {
          expectedScheduleRevision: 4,
          changes: [{ kind: 'create_workout', title: 'Private title' }],
        },
      },
    }, now);

    expect(diagnostic).toMatchObject({
      toolName: 'preview_training_changes',
      inputValid: false,
      changeCount: 1,
      changeKinds: ['alias:create_workout'],
      firstChangeFields: ['kind', 'title'],
    });
    expect(JSON.stringify(diagnostic)).not.toContain('Private');
  });

  it('does not log unrecognized kinds or operate after expiry', () => {
    const body = {
      method: 'tools/call',
      params: {
        name: 'preview_training_changes',
        arguments: { expectedScheduleRevision: 4, changes: [{ kind: 'sensitive-value' }] },
      },
    };
    expect(buildTemporaryTrainingRequestDiagnostic(body, now)?.changeKinds)
      .toEqual(['<unrecognized>']);
    expect(buildTemporaryTrainingRequestDiagnostic(
      body,
      TEMPORARY_TRAINING_DIAGNOSTICS_EXPIRES_AT_MS,
    )).toBeNull();
  });

  it('ignores non-Training tools', () => {
    expect(buildTemporaryTrainingRequestDiagnostic({
      method: 'tools/call',
      params: { name: 'query_planned_workouts', arguments: {} },
    }, now)).toBeNull();
  });
});
