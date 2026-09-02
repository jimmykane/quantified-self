import {
  ActivityTypes,
  DistanceUnits,
  PaceUnits,
  SpeedUnits,
} from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import {
  INITIAL_MANUAL_WORKOUT_EDITOR_PROFILE_V1,
  WORKOUT_STRUCTURE_MAX_NODES,
  WorkoutStructureValidationError,
  countWorkoutStructureNodesV1,
  deserializeWorkoutStructureV1,
  evaluateWorkoutCompatibilityV1,
  formatWorkoutEndingV1,
  formatWorkoutTargetV1,
  parseWorkoutStructureV1,
  serializeWorkoutStructureV1,
  toFirestoreWorkoutStructureV1,
  type WorkoutStructureV1,
} from '@shared/planned-workout';

const COMPLETE_STRUCTURE_INPUT = {
  version: 1,
  sport: 'run',
  nodes: [
    {
      kind: 'step',
      id: 'warmup',
      purpose: 'warmup',
      ending: { kind: 'time', seconds: 600 },
      targets: [{
        kind: 'heart-rate',
        mode: 'absolute',
        minimumBpm: 120,
        maximumBpm: 140,
      }],
      note: '  Easy start  ',
    },
    {
      kind: 'repeat',
      id: 'main-set',
      count: 4,
      steps: [
        {
          kind: 'step',
          id: 'work',
          purpose: 'work',
          ending: { kind: 'distance', meters: 1000 },
          targets: [
            {
              kind: 'speed',
              mode: 'absolute',
              minimumMetersPerSecond: 1000 / 300,
              maximumMetersPerSecond: 1000 / 240,
              presentation: 'pace',
            },
            {
              kind: 'cadence',
              mode: 'relative',
              minimumPercent: 95,
              maximumPercent: 105,
              reference: { kind: 'preferred-cadence', rpm: 180 },
            },
          ],
        },
        {
          kind: 'step',
          id: 'recovery',
          purpose: 'recovery',
          ending: { kind: 'manual' },
          targets: [],
        },
      ],
    },
  ],
};

function expectValidationIssue(
  value: unknown,
  code: WorkoutStructureValidationError['issues'][number]['code'],
  path?: string,
): void {
  try {
    parseWorkoutStructureV1(value);
    throw new Error('Expected workout validation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(WorkoutStructureValidationError);
    const issues = (error as WorkoutStructureValidationError).issues;
    expect(issues.some(issue => issue.code === code && (path === undefined || issue.path === path))).toBe(true);
  }
}

describe('planned workout v1 contract', () => {
  it('normalizes Sports Lib activity aliases and trims optional notes', () => {
    const result = parseWorkoutStructureV1(COMPLETE_STRUCTURE_INPUT);

    expect(result.sport).toBe(ActivityTypes.Running);
    expect(result.nodes[0]).toMatchObject({ note: 'Easy start' });
    expect(countWorkoutStructureNodesV1(result)).toBe(4);
  });

  it('round-trips through JSON without changing the canonical v1 value', () => {
    const normalized = parseWorkoutStructureV1(COMPLETE_STRUCTURE_INPUT);
    const serialized = serializeWorkoutStructureV1(normalized);

    expect(deserializeWorkoutStructureV1(serialized)).toEqual(normalized);
    expect(JSON.stringify(deserializeWorkoutStructureV1(serialized))).toBe(serialized);
  });

  it('returns a detached Firestore-safe plain JSON value', () => {
    const normalized = parseWorkoutStructureV1(COMPLETE_STRUCTURE_INPUT);
    const firestoreValue = toFirestoreWorkoutStructureV1(normalized);

    expect(firestoreValue).toEqual(normalized);
    expect(firestoreValue).not.toBe(normalized);
    expect(JSON.parse(JSON.stringify(firestoreValue))).toEqual(firestoreValue);
    expect(JSON.stringify(firestoreValue)).not.toContain('undefined');
  });

  it('rejects invalid JSON and unsupported structure versions', () => {
    expect(() => deserializeWorkoutStructureV1('{oops')).toThrow(WorkoutStructureValidationError);
    expectValidationIssue({ ...COMPLETE_STRUCTURE_INPUT, version: 2 }, 'unsupported_version', '$.version');
  });

  it('rejects invalid sports, unknown fields, and unknown discriminants', () => {
    expectValidationIssue({ ...COMPLETE_STRUCTURE_INPUT, sport: 'space jogging' }, 'invalid_value', '$.sport');
    expectValidationIssue({ ...COMPLETE_STRUCTURE_INPUT, provider: 'garmin' }, 'unknown_field', '$.provider');
    expectValidationIssue({
      ...COMPLETE_STRUCTURE_INPUT,
      nodes: [{ kind: 'teleport', id: 'bad' }],
    }, 'unknown_discriminant', '$.nodes[0].kind');
  });

  it('rejects duplicate IDs and nested repeats', () => {
    expectValidationIssue({
      ...COMPLETE_STRUCTURE_INPUT,
      nodes: [COMPLETE_STRUCTURE_INPUT.nodes[0], { ...COMPLETE_STRUCTURE_INPUT.nodes[0] }],
    }, 'duplicate_id', '$.nodes[1].id');

    expectValidationIssue({
      version: 1,
      sport: ActivityTypes.Cycling,
      nodes: [{
        kind: 'repeat',
        id: 'outer',
        count: 2,
        steps: [{ kind: 'repeat', id: 'inner', count: 2, steps: [] }],
      }],
    }, 'unknown_discriminant', '$.nodes[0].steps[0].kind');
  });

  it('rejects non-finite, negative, and inverted scalar ranges', () => {
    expectValidationIssue({
      version: 1,
      sport: ActivityTypes.Running,
      nodes: [{
        kind: 'step',
        id: 'bad-time',
        purpose: 'work',
        ending: { kind: 'time', seconds: Number.POSITIVE_INFINITY },
        targets: [],
      }],
    }, 'invalid_value', '$.nodes[0].ending.seconds');

    expectValidationIssue({
      version: 1,
      sport: ActivityTypes.Running,
      nodes: [{
        kind: 'step',
        id: 'bad-distance',
        purpose: 'work',
        ending: { kind: 'distance', meters: -1 },
        targets: [],
      }],
    }, 'invalid_value', '$.nodes[0].ending.meters');

    expectValidationIssue({
      version: 1,
      sport: ActivityTypes.Cycling,
      nodes: [{
        kind: 'step',
        id: 'bad-range',
        purpose: 'work',
        ending: { kind: 'time', seconds: 300 },
        targets: [{
          kind: 'power',
          mode: 'absolute',
          minimumWatts: 300,
          maximumWatts: 250,
        }],
      }],
    }, 'inverted_range', '$.nodes[0].targets[0].maximumWatts');
  });

  it('allows zero target bounds while keeping endings and pace speeds positive', () => {
    expect(parseWorkoutStructureV1({
      version: 1,
      sport: ActivityTypes.Cycling,
      nodes: [{
        kind: 'step',
        id: 'coast',
        purpose: 'recovery',
        ending: { kind: 'time', seconds: 60 },
        targets: [{ kind: 'power', mode: 'absolute', minimumWatts: 0, maximumWatts: 50 }],
      }],
    }).nodes[0]).toMatchObject({ targets: [{ minimumWatts: 0, maximumWatts: 50 }] });

    expectValidationIssue({
      version: 1,
      sport: ActivityTypes.Running,
      nodes: [{
        kind: 'step',
        id: 'bad-pace',
        purpose: 'work',
        ending: { kind: 'time', seconds: 60 },
        targets: [{
          kind: 'speed',
          mode: 'absolute',
          minimumMetersPerSecond: 0,
          maximumMetersPerSecond: 3,
          presentation: 'pace',
        }],
      }],
    }, 'invalid_value', '$.nodes[0].targets[0]');
  });

  it('enforces node, repeat, and target limits', () => {
    const nodes = Array.from({ length: WORKOUT_STRUCTURE_MAX_NODES + 1 }, (_, index) => ({
      kind: 'step',
      id: `step-${index}`,
      purpose: 'work',
      ending: { kind: 'time', seconds: 1 },
      targets: [],
    }));
    expectValidationIssue({ version: 1, sport: ActivityTypes.Running, nodes }, 'limit_exceeded', '$.nodes');

    expectValidationIssue({
      version: 1,
      sport: ActivityTypes.Running,
      nodes: [{
        kind: 'repeat',
        id: 'too-many',
        count: 101,
        steps: [{
          kind: 'step',
          id: 'work',
          purpose: 'work',
          ending: { kind: 'time', seconds: 60 },
          targets: [],
        }],
      }],
    }, 'limit_exceeded', '$.nodes[0].count');

    expectValidationIssue({
      version: 1,
      sport: ActivityTypes.Running,
      nodes: [{
        kind: 'step',
        id: 'too-many-targets',
        purpose: 'work',
        ending: { kind: 'time', seconds: 60 },
        targets: [
          { kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 140 },
          { kind: 'power', mode: 'absolute', minimumWatts: 200, maximumWatts: 250 },
          { kind: 'cadence', mode: 'absolute', minimumRpm: 80, maximumRpm: 90 },
        ],
      }],
    }, 'limit_exceeded', '$.nodes[0].targets');
  });
});

describe('planned workout compatibility', () => {
  it('accepts the first manual editor slice', () => {
    const workout: WorkoutStructureV1 = {
      version: 1,
      sport: ActivityTypes.Cycling,
      nodes: [{
        kind: 'step',
        id: 'ride',
        purpose: 'work',
        ending: { kind: 'time', seconds: 1800 },
        targets: [{ kind: 'power', mode: 'absolute', minimumWatts: 180, maximumWatts: 220 }],
      }],
    };

    expect(evaluateWorkoutCompatibilityV1(workout, INITIAL_MANUAL_WORKOUT_EDITOR_PROFILE_V1)).toEqual({
      compatible: true,
      issues: [],
    });
  });

  it('reports every unsupported feature instead of degrading the recipe silently', () => {
    const result = evaluateWorkoutCompatibilityV1({
      version: 1,
      sport: ActivityTypes.TrailRunning,
      nodes: [{
        kind: 'step',
        id: 'trail',
        purpose: 'work',
        ending: { kind: 'manual' },
        targets: [{
          kind: 'cadence',
          mode: 'relative',
          minimumPercent: 95,
          maximumPercent: 105,
          reference: { kind: 'preferred-cadence', rpm: 170 },
        }],
      }],
    }, INITIAL_MANUAL_WORKOUT_EDITOR_PROFILE_V1);

    expect(result.compatible).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual([
      'unsupported_sport',
      'unsupported_ending',
      'unsupported_target',
      'unsupported_relative_target',
    ]);
  });
});

describe('planned workout formatting', () => {
  it('uses Sports Lib unit-aware formatters for canonical endings and targets', () => {
    expect(formatWorkoutEndingV1({ kind: 'distance', meters: 1000 })).toContain('Km');
    expect(formatWorkoutEndingV1({ kind: 'kilojoules', kilojoules: 250 })).toContain('kJ');
    expect(formatWorkoutTargetV1({
      kind: 'heart-rate',
      mode: 'absolute',
      minimumBpm: 140,
      maximumBpm: 150,
    })).toBe('140–150 bpm');
    expect(formatWorkoutTargetV1({
      kind: 'speed',
      mode: 'absolute',
      minimumMetersPerSecond: 1000 / 300,
      maximumMetersPerSecond: 1000 / 240,
      presentation: 'pace',
    })).toBe('04:00–05:00 min/km');
  });

  it('honors imperial distance and pace preferences without changing storage', () => {
    const imperial = normalizeUserUnitSettings({
      distanceUnits: DistanceUnits.Miles,
      paceUnits: [PaceUnits.MinutesPerMile],
      speedUnits: [SpeedUnits.MilesPerHour],
    });

    expect(formatWorkoutEndingV1({ kind: 'distance', meters: 1609.344 }, imperial)).toContain('mi');
    expect(formatWorkoutTargetV1({
      kind: 'speed',
      mode: 'absolute',
      minimumMetersPerSecond: 1000 / 300,
      maximumMetersPerSecond: 1000 / 240,
      presentation: 'pace',
    }, imperial)).toContain('min/m');
  });
});
