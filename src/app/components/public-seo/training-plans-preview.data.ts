import { ActivityTypes } from '@sports-alliance/sports-lib';
import {
  parseScheduledWorkoutV1,
  parseTrainingPlanV1,
  type ScheduledWorkoutV1,
  type TrainingPlanV1,
} from '@shared/training-plans';

export const TRAINING_PLANS_PREVIEW_TODAY = '2026-10-06';
export const TRAINING_PLANS_PREVIEW_EMPTY_DATE = '2026-10-08';

const FIXTURE_TIMESTAMP_MS = Date.UTC(2026, 8, 1, 12);

export const TRAINING_PLANS_PREVIEW_PLAN: TrainingPlanV1 = parseTrainingPlanV1({
  schemaVersion: 1,
  id: 'autumn-build',
  name: 'Autumn run + ride build',
  color: 'purple',
  lifecycle: 'active',
  startLocalDate: '2026-09-21',
  endLocalDate: '2026-11-08',
  revision: 8,
  lastCheckpointRevision: 1,
  workoutCount: 8,
  createdAtMs: FIXTURE_TIMESTAMP_MS,
  updatedAtMs: FIXTURE_TIMESTAMP_MS,
});

const WORKOUT_FIXTURES: readonly unknown[] = [
  {
    schemaVersion: 1,
    id: 'easy-aerobic-run',
    planId: TRAINING_PLANS_PREVIEW_PLAN.id,
    localDate: '2026-09-22',
    lifecycle: 'planned',
    title: 'Easy aerobic run',
    structure: {
      version: 1,
      sport: ActivityTypes.Running,
      nodes: [
        { kind: 'step', id: 'warmup', purpose: 'warmup', ending: { kind: 'time', seconds: 600 }, targets: [] },
        {
          kind: 'step', id: 'easy', purpose: 'work', ending: { kind: 'time', seconds: 1800 },
          targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 130, maximumBpm: 148 }],
        },
        { kind: 'step', id: 'cooldown', purpose: 'cooldown', ending: { kind: 'time', seconds: 300 }, targets: [] },
      ],
    },
    revision: 1,
    createdAtMs: FIXTURE_TIMESTAMP_MS,
    updatedAtMs: FIXTURE_TIMESTAMP_MS,
  },
  {
    schemaVersion: 1,
    id: 'steady-endurance-ride',
    planId: TRAINING_PLANS_PREVIEW_PLAN.id,
    localDate: '2026-09-26',
    lifecycle: 'planned',
    title: 'Steady endurance ride',
    structure: {
      version: 1,
      sport: ActivityTypes.Cycling,
      nodes: [
        { kind: 'step', id: 'ride', purpose: 'work', ending: { kind: 'distance', meters: 42000 }, targets: [] },
      ],
    },
    revision: 1,
    createdAtMs: FIXTURE_TIMESTAMP_MS,
    updatedAtMs: FIXTURE_TIMESTAMP_MS,
  },
  {
    schemaVersion: 1,
    id: 'track-pace-set',
    planId: TRAINING_PLANS_PREVIEW_PLAN.id,
    localDate: '2026-09-29',
    lifecycle: 'planned',
    title: 'Track pace set',
    structure: {
      version: 1,
      sport: ActivityTypes.Running,
      nodes: [
        { kind: 'step', id: 'warmup', purpose: 'warmup', ending: { kind: 'time', seconds: 900 }, targets: [] },
        {
          kind: 'repeat', id: 'repeats', count: 5, steps: [
            {
              kind: 'step', id: 'fast-kilometer', purpose: 'work', ending: { kind: 'distance', meters: 1000 },
              targets: [{
                kind: 'speed', mode: 'absolute', minimumMetersPerSecond: 3.3333333333,
                maximumMetersPerSecond: 3.5087719298, presentation: 'pace',
              }],
            },
            { kind: 'step', id: 'recovery', purpose: 'recovery', ending: { kind: 'time', seconds: 120 }, targets: [] },
          ],
        },
      ],
    },
    revision: 1,
    createdAtMs: FIXTURE_TIMESTAMP_MS,
    updatedAtMs: FIXTURE_TIMESTAMP_MS,
  },
  {
    schemaVersion: 1,
    id: 'long-progression-run',
    planId: TRAINING_PLANS_PREVIEW_PLAN.id,
    localDate: '2026-10-03',
    lifecycle: 'skipped',
    title: 'Long progression run',
    structure: {
      version: 1,
      sport: ActivityTypes.TrailRunning,
      nodes: [
        { kind: 'step', id: 'long-run', purpose: 'work', ending: { kind: 'time', seconds: 5400 }, targets: [] },
      ],
    },
    revision: 2,
    createdAtMs: FIXTURE_TIMESTAMP_MS,
    updatedAtMs: FIXTURE_TIMESTAMP_MS,
  },
  {
    schemaVersion: 1,
    id: 'threshold-bike-blocks',
    planId: TRAINING_PLANS_PREVIEW_PLAN.id,
    localDate: TRAINING_PLANS_PREVIEW_TODAY,
    lifecycle: 'planned',
    title: 'Threshold bike blocks',
    structure: {
      version: 1,
      sport: ActivityTypes.IndoorCycling,
      nodes: [
        { kind: 'step', id: 'warmup', purpose: 'warmup', ending: { kind: 'time', seconds: 720 }, targets: [] },
        {
          kind: 'repeat', id: 'blocks', count: 3, steps: [
            {
              kind: 'step', id: 'threshold', purpose: 'work', ending: { kind: 'time', seconds: 480 },
              targets: [{ kind: 'power', mode: 'absolute', minimumWatts: 245, maximumWatts: 270 }],
            },
            { kind: 'step', id: 'easy-spin', purpose: 'recovery', ending: { kind: 'time', seconds: 240 }, targets: [] },
          ],
        },
      ],
    },
    revision: 1,
    createdAtMs: FIXTURE_TIMESTAMP_MS,
    updatedAtMs: FIXTURE_TIMESTAMP_MS,
  },
  {
    schemaVersion: 1,
    id: 'easy-recovery-run',
    planId: TRAINING_PLANS_PREVIEW_PLAN.id,
    localDate: '2026-10-13',
    lifecycle: 'planned',
    title: 'Easy recovery run',
    structure: {
      version: 1,
      sport: ActivityTypes.Treadmill,
      nodes: [
        {
          kind: 'step', id: 'recovery-run', purpose: 'recovery', ending: { kind: 'time', seconds: 2100 },
          targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 122, maximumBpm: 138 }],
        },
      ],
    },
    revision: 1,
    createdAtMs: FIXTURE_TIMESTAMP_MS,
    updatedAtMs: FIXTURE_TIMESTAMP_MS,
  },
  {
    schemaVersion: 1,
    id: 'rolling-hills-ride',
    planId: TRAINING_PLANS_PREVIEW_PLAN.id,
    localDate: '2026-10-24',
    lifecycle: 'planned',
    title: 'Rolling hills ride',
    structure: {
      version: 1,
      sport: ActivityTypes.MountainBiking,
      nodes: [
        { kind: 'step', id: 'hills', purpose: 'work', ending: { kind: 'distance', meters: 32000 }, targets: [] },
      ],
    },
    revision: 1,
    createdAtMs: FIXTURE_TIMESTAMP_MS,
    updatedAtMs: FIXTURE_TIMESTAMP_MS,
  },
  {
    schemaVersion: 1,
    id: 'november-steady-run',
    planId: TRAINING_PLANS_PREVIEW_PLAN.id,
    localDate: '2026-11-03',
    lifecycle: 'planned',
    title: 'November steady run',
    structure: {
      version: 1,
      sport: ActivityTypes.Running,
      nodes: [
        {
          kind: 'step', id: 'steady-run', purpose: 'work', ending: { kind: 'distance', meters: 10000 },
          targets: [{
            kind: 'speed', mode: 'absolute', minimumMetersPerSecond: 3.0303030303,
            maximumMetersPerSecond: 3.2258064516, presentation: 'pace',
          }],
        },
      ],
    },
    revision: 1,
    createdAtMs: FIXTURE_TIMESTAMP_MS,
    updatedAtMs: FIXTURE_TIMESTAMP_MS,
  },
];

export const TRAINING_PLANS_PREVIEW_WORKOUTS: readonly ScheduledWorkoutV1[] = WORKOUT_FIXTURES
  .map(workout => parseScheduledWorkoutV1(workout));
