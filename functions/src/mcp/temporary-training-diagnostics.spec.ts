import { describe, expect, it } from 'vitest';
import {
  buildTemporaryTrainingRequestDiagnostic,
  TEMPORARY_TRAINING_DIAGNOSTICS_EXPIRES_AT_MS,
} from './temporary-training-diagnostics';

const activeTime = TEMPORARY_TRAINING_DIAGNOSTICS_EXPIRES_AT_MS - 1;

describe('temporary MCP Training diagnostics', () => {
  it('reports only safe shape and validation paths for an invalid workout preview', () => {
    const diagnostic = buildTemporaryTrainingRequestDiagnostic({
      method: 'tools/call',
      params: {
        name: 'preview_training_changes',
        arguments: {
          expectedScheduleRevision: 2,
          changes: [{
            kind: 'create-workout',
            localKey: 'private-key',
            title: 'Private workout title',
            localDate: '2026-09-20',
            plan: null,
            structure: {
              version: 1,
              sport: 'Private invalid sport',
              nodes: [],
              privateField: 'must not be logged',
            },
          }],
        },
      },
    }, activeTime);

    expect(diagnostic).toMatchObject({
      toolName: 'preview_training_changes',
      inputValid: false,
      argumentsShape: 'object',
      changeCount: 1,
      changeKinds: ['create-workout'],
    });
    expect(diagnostic?.validationIssues.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain('Private workout title');
    expect(serialized).not.toContain('Private invalid sport');
    expect(serialized).not.toContain('private-key');
    expect(serialized).not.toContain('privateField');
    expect(serialized).not.toContain('must not be logged');
  });

  it('reports a valid apply shape without logging the proposal reference', () => {
    const diagnostic = buildTemporaryTrainingRequestDiagnostic({
      method: 'tools/call',
      params: {
        name: 'apply_training_changes',
        arguments: {
          proposalRef: 'private-proposal-reference',
          permissionMode: 'schedule',
        },
      },
    }, activeTime);

    expect(diagnostic).toEqual({
      toolName: 'apply_training_changes',
      inputValid: true,
      argumentsShape: 'object',
      validationIssues: [],
      permissionMode: 'schedule',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('private-proposal-reference');
  });

  it('ignores other tools and self-disables at expiry', () => {
    expect(buildTemporaryTrainingRequestDiagnostic({
      method: 'tools/call',
      params: { name: 'query_planned_workouts', arguments: {} },
    }, activeTime)).toBeNull();
    expect(buildTemporaryTrainingRequestDiagnostic({
      method: 'tools/call',
      params: { name: 'preview_training_changes', arguments: {} },
    }, TEMPORARY_TRAINING_DIAGNOSTICS_EXPIRES_AT_MS)).toBeNull();
  });
});
