import { ActivityTypes } from '@sports-alliance/sports-lib';
import {
  addDaysToTrainingLocalDate,
  parseScheduledWorkoutV1,
  parseTrainingPlanV1,
  type ScheduledWorkoutV1,
  type TrainingPlanV1,
} from '@shared/training-plans';

export interface TrainingPlansPreviewFixture {
  plan: TrainingPlanV1;
  workouts: readonly ScheduledWorkoutV1[];
  today: string;
  emptyDate: string;
  completedWorkoutIds: readonly string[];
}

interface PreviewWorkoutTemplate {
  id: string;
  dayOffset: number;
  lifecycle: ScheduledWorkoutV1['lifecycle'];
  title: string;
  structure: ScheduledWorkoutV1['structure'];
  revision?: number;
}

const PLAN_ID = 'current-run-ride-build';
const COMPLETED_WORKOUT_ID = 'threshold-bike-blocks';

const WORKOUT_TEMPLATES: readonly PreviewWorkoutTemplate[] = [
  {
    id: 'easy-aerobic-run', dayOffset: -14, lifecycle: 'planned', title: 'Easy aerobic run',
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
  },
  {
    id: 'steady-endurance-ride', dayOffset: -10, lifecycle: 'planned', title: 'Steady endurance ride',
    structure: {
      version: 1,
      sport: ActivityTypes.Cycling,
      nodes: [
        { kind: 'step', id: 'ride', purpose: 'work', ending: { kind: 'distance', meters: 42000 }, targets: [] },
      ],
    },
  },
  {
    id: 'track-pace-set', dayOffset: -7, lifecycle: 'planned', title: 'Track pace set',
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
  },
  {
    id: 'long-progression-run', dayOffset: -3, lifecycle: 'skipped', title: 'Long progression run', revision: 2,
    structure: {
      version: 1,
      sport: ActivityTypes.TrailRunning,
      nodes: [
        { kind: 'step', id: 'long-run', purpose: 'work', ending: { kind: 'time', seconds: 5400 }, targets: [] },
      ],
    },
  },
  {
    id: COMPLETED_WORKOUT_ID, dayOffset: 0, lifecycle: 'planned', title: 'Threshold bike blocks',
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
  },
  {
    id: 'easy-recovery-run', dayOffset: 7, lifecycle: 'planned', title: 'Easy recovery run',
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
  },
  {
    id: 'rolling-hills-ride', dayOffset: 18, lifecycle: 'planned', title: 'Rolling hills ride',
    structure: {
      version: 1,
      sport: ActivityTypes.MountainBiking,
      nodes: [
        { kind: 'step', id: 'hills', purpose: 'work', ending: { kind: 'distance', meters: 32000 }, targets: [] },
      ],
    },
  },
  {
    id: 'steady-10k-run', dayOffset: 28, lifecycle: 'planned', title: 'Steady 10K run',
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
  },
];

/**
 * Builds a fixed synthetic workout recipe around one local calendar date. Capturing the date once keeps a rendered
 * preview internally stable while making the selected month relevant whenever a visitor opens the page.
 */
export function buildTrainingPlansPreviewFixture(referenceDate = new Date()): TrainingPlansPreviewFixture {
  const today = formatLocalDate(referenceDate);
  const timestampMs = Date.UTC(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate(), 12);
  const plan = parseTrainingPlanV1({
    schemaVersion: 1,
    id: PLAN_ID,
    name: 'Run + ride build',
    color: 'purple',
    lifecycle: 'active',
    startLocalDate: addDaysToTrainingLocalDate(today, -16),
    endLocalDate: addDaysToTrainingLocalDate(today, 35),
    revision: 8,
    lastCheckpointRevision: 1,
    workoutCount: WORKOUT_TEMPLATES.length,
    createdAtMs: timestampMs,
    updatedAtMs: timestampMs,
  });
  const workouts = WORKOUT_TEMPLATES.map(template => parseScheduledWorkoutV1({
    schemaVersion: 1,
    id: template.id,
    planId: plan.id,
    localDate: addDaysToTrainingLocalDate(today, template.dayOffset),
    lifecycle: template.lifecycle,
    title: template.title,
    structure: template.structure,
    revision: template.revision ?? 1,
    createdAtMs: timestampMs,
    updatedAtMs: timestampMs,
  }));
  return {
    plan,
    workouts,
    today,
    emptyDate: addDaysToTrainingLocalDate(today, 2),
    completedWorkoutIds: [COMPLETED_WORKOUT_ID],
  };
}

function formatLocalDate(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new TypeError('Expected a valid preview reference date.');
  return [
    `${value.getFullYear()}`.padStart(4, '0'),
    `${value.getMonth() + 1}`.padStart(2, '0'),
    `${value.getDate()}`.padStart(2, '0'),
  ].join('-');
}
