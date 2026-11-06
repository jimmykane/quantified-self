import { describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { parseWorkoutStructureV1, WorkoutStructureValidationError } from '../../../shared/planned-workout';
import { parseStrengthWorkoutDraftV1, StrengthWorkoutValidationError } from '../../../shared/strength-workout';
import { dayWorkoutValidationDiagnostics } from './day-workout-diagnostics';

function failure(parse: () => unknown): unknown { try { parse(); } catch (error) { return error; } throw Error('Expected invalid fixture'); }
const step = { kind: 'step', id: 'PRIVATE_NODE_ID', purpose: 'work', ending: { kind: 'time', seconds: 300 }, targets: [] };

describe('day workout validation diagnostics', () => {
  it('identifies canonical value failures without including authored values', () => {
    const error = failure(() => parseWorkoutStructureV1({ version: 1, sport: ActivityTypes.Running,
      poolLength: { meters: 25, presentation: 'meters' }, nodes: [{ ...step, note: ' ' }, step] }));
    expect(dayWorkoutValidationDiagnostics(error)).toEqual([
      { code: 'invalid_value', field: '$.structure.poolLength', reason: 'Pool length is only valid for pool swimming.' },
      { code: 'invalid_value', field: '$.structure.nodes[].note', reason: 'Expected a non-empty string of at most 500 characters.' },
      { code: 'duplicate_id', field: '$.structure.nodes[].id', reason: 'Use unique IDs throughout the prescription.' },
    ]);
    expect(JSON.stringify(dayWorkoutValidationDiagnostics(error))).not.toContain('PRIVATE_NODE_ID');
  });
  it('identifies a repeated step and a target range without exposing its numeric values', () => {
    const error = failure(() => parseWorkoutStructureV1({ version: 1, sport: ActivityTypes.Running, nodes: [
      { kind: 'repeat', id: 'repeat', count: 101, steps: [{ ...step, targets: [
        { kind: 'power', mode: 'absolute', minimumWatts: 987, maximumWatts: 123 },
      ] }] },
    ] }));
    expect(dayWorkoutValidationDiagnostics(error)).toEqual([
      { code: 'limit_exceeded', field: '$.structure.nodes[].count', reason: 'Must be at most 100.' },
      { code: 'inverted_range', field: '$.structure.nodes[].steps[].targets[].maximumWatts', reason: 'The maximum must be greater than or equal to the minimum.' },
    ]);
  });
  it('keeps unknown keys, malicious messages, unsupported codes and oversized paths out of diagnostics', () => {
    const error = new WorkoutStructureValidationError([
      { code: 'unknown_field', path: '$.nodes[0].PRIVATE_FIELD', message: 'PRIVATE_VALUE' },
      { code: 'invalid_value', path: '$.nodes[0].note', message: 'PRIVATE_VALUE' },
      { code: 'invalid_value', path: '$.' + 'PRIVATE'.repeat(100), message: 'PRIVATE_VALUE' },
      { code: 'PRIVATE_CODE' as never, path: '$.nodes[0].id', message: 'PRIVATE_VALUE' },
      { code: '__proto__' as never, path: '$.nodes[0].id', message: 'PRIVATE_VALUE' },
    ]);
    const diagnostics = dayWorkoutValidationDiagnostics(error);
    expect(diagnostics.map(issue => issue.field)).toEqual(['$.structure.nodes[]', '$.structure.nodes[].note', '$.structure']);
    expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE');
    expect(diagnostics[0].reason).toBe('Remove fields not in the requested schema.');
  });
  it('deduplicates normalized fields and caps diagnostics at five issues', () => {
    const issues = ['note', 'note', 'id', 'count', 'ending', 'targets', 'purpose'].map((field, index) => ({
      code: 'invalid_value' as const, path: `$.nodes[${index}].${field}`, message: 'PRIVATE_VALUE',
    }));
    const diagnostics = dayWorkoutValidationDiagnostics(new WorkoutStructureValidationError(issues));
    expect(diagnostics).toHaveLength(5);
    expect(diagnostics.filter(issue => issue.field.endsWith('.note'))).toHaveLength(1);
    expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE_VALUE');
  });
  it('reports strength fields and constraints without exercise names or repetition values', () => {
    const error = failure(() => parseStrengthWorkoutDraftV1({ version: 1, exercises: [
      { id: 'PRIVATE_ID', name: 'PRIVATE_EXERCISE', sets: [{ id: 'set', ending: { kind: 'repetitions', repetitions: 1501 } }] },
    ] }));
    expect(dayWorkoutValidationDiagnostics(error)).toEqual([
      { code: 'invalid_value', field: '$.strength.exercises[].sets[].ending.repetitions', reason: 'Expected an integer from 1 to 1000.' },
    ]);
    const unknown = new StrengthWorkoutValidationError('$.exercises[0].PRIVATE_KEY', 'Unknown field.');
    expect(dayWorkoutValidationDiagnostics(unknown)).toEqual([
      { code: 'unknown_field', field: '$.strength.exercises[]', reason: 'Remove fields not in the requested schema.' },
    ]);
  });
  it('does not inspect unknown error types or arbitrary provider responses', () => {
    expect(dayWorkoutValidationDiagnostics(new Error('PRIVATE_PROVIDER_RESPONSE'))).toEqual([]);
  });
});
