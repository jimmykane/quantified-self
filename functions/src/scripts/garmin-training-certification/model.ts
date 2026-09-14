import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { normalizeTrainingLocalDate, type ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { normalizeDeliveryTimeZone } from '../../../../shared/training-provider-delivery';
import { serializeGarminWorkoutV1 } from '../../training-plans/providers/garmin-workout.serializer';
import { assessTrainingDeliveryMapping } from '../../training-plans/delivery/mapping';

const date = z.string().refine(value => {
  try { return normalizeTrainingLocalDate(value) === value; } catch { return false; }
});
const zone = z.string().refine(value => {
  try { return normalizeDeliveryTimeZone(value) === value; } catch { return false; }
});
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const long = z.string().regex(/^[1-9]\d{0,18}$/).refine(value => BigInt(value) <= 9223372036854775807n);
export const bindingSchema = z.object({ destinationKey: z.string().regex(/^[a-f0-9]{64}$/),
  generation: z.string().min(1).max(1024), epoch: integer }).strict();
export type Binding = z.infer<typeof bindingSchema>;
export const configSchema = z.object({ project: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/),
  uid: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), date, timeZone: zone, sport: z.enum(['running', 'cycling']) }).strict();
export type Config = z.infer<typeof configSchema>;
const artifactSchema = z.object({ ids: z.object({ workout: long, owner: long.optional(), schedule: long.optional() }).strict(),
  localDate: date, completed: z.boolean() }).strict();
const progressSchema = z.object({ version: z.literal(1), step: z.enum(['workout-create', 'workout-update', 'schedule-create',
  'schedule-update', 'schedule-delete', 'workout-delete', 'finished']), state: z.enum(['ready', 'started', 'rejected', 'accepted']) }).strict();
export const mutationActions = ['create', 'update', 'reschedule', 'remove'] as const;
export type MutationAction = typeof mutationActions[number];
export type Action = MutationAction | 'inspect';
export const stateSchema = z.object({ version: z.literal(1), runId: z.string().uuid(), revision: integer,
  config: configSchema, binding: bindingSchema.nullable(), phase: z.enum(['prepared', 'created', 'updated', 'rescheduled', 'removed']),
  artifact: artifactSchema.nullable(), retained: artifactSchema.nullable(),
  pending: z.object({ id: z.string().uuid(), action: z.enum(mutationActions), progress: progressSchema.nullable() }).strict().nullable(),
  requestCount: integer.max(64), nextRequestAtMs: integer, retryAtMs: integer,
  requests: z.array(z.object({ method: z.enum(['GET', 'POST', 'PUT', 'DELETE']), resource: z.enum(['workout', 'schedule', 'schedule-list']),
    status: z.number().int().min(100).max(599).nullable(), latencyMs: integer.nullable() }).strict()).max(64),
  observations: z.array(z.object({ phase: z.enum(['prepared', 'created', 'updated', 'rescheduled', 'removed']),
    passed: z.boolean(), atMs: integer }).strict()).max(24),
  failure: z.enum(['auth', 'permission', 'retryable', 'terminal', 'uncertain', 'local_failure']).nullable(),
}).strict();
export type RunState = z.infer<typeof stateSchema>;

export function initialState(config: Config): RunState {
  return stateSchema.parse({ version: 1, runId: randomUUID(), revision: 0, config, binding: null, phase: 'prepared',
    artifact: null, retained: null, pending: null, requestCount: 0, nextRequestAtMs: 0, retryAtMs: 0, requests: [], observations: [], failure: null });
}
export function nextDate(value: string): string {
  return normalizeTrainingLocalDate(new Date(Date.parse(`${value}T12:00:00Z`) + 86400000).toISOString().slice(0, 10));
}
export function title(state: RunState): string { return `QS cert ${state.runId.slice(0, 8)}`; }

/** Fixed synthetic recipes only: no real user workout export or arbitrary provider payload. */
export function fixture(state: RunState, action: MutationAction): ScheduledWorkoutV1 {
  const updated = action !== 'create';
  const revision = action === 'create' ? 1 : action === 'update' ? 2 : 3;
  return { schemaVersion: 1, id: state.runId, planId: null, revision, title: title(state),
    localDate: action === 'reschedule' || (action === 'remove' && state.phase === 'rescheduled') ? nextDate(state.config.date) : state.config.date,
    lifecycle: 'planned', createdAtMs: 1, updatedAtMs: revision,
    structure: { version: 1, sport: state.config.sport === 'running' ? ActivityTypes.Running : ActivityTypes.Cycling,
      nodes: [
        { id: 'warmup', kind: 'step', purpose: 'warmup', ending: { kind: 'time', seconds: 300 }, targets: [] },
        { id: 'intervals', kind: 'repeat', count: 2, steps: [
          { id: 'work', kind: 'step', purpose: 'work', ending: { kind: 'distance', meters: updated ? 600 : 400 },
            targets: state.config.sport === 'running'
              ? [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 130, maximumBpm: updated ? 155 : 150 }]
              : [{ kind: 'power', mode: 'absolute', minimumWatts: 150, maximumWatts: updated ? 220 : 200 }] },
          { id: 'recovery', kind: 'step', purpose: 'recovery', ending: { kind: 'time', seconds: 60 }, targets: [] },
        ] },
        { id: 'cooldown', kind: 'step', purpose: 'cooldown', ending: { kind: 'manual' }, targets: [] },
      ] },
  };
}

/** Approval expires after ANY journal change, including an attempted HTTP request. */
export function approval(state: RunState, action: string, candidate: Binding | null = null): string {
  const workout = action === 'create' || action === 'update' || action === 'reschedule' ? fixture(state, action) : null;
  const mapping = workout ? { assessment: assessTrainingDeliveryMapping('garmin', workout, state.binding?.destinationKey ?? '', state.config.timeZone),
    payload: serializeGarminWorkoutV1(workout.structure, { name: workout.title, allowDegraded: false }).artifact } : null;
  return createHash('sha256').update(JSON.stringify({ protocol: 'garmin-certification-v1', state, action, candidate, mapping })).digest('hex');
}
export function report(state: RunState) {
  return { schemaVersion: 1, evidence: 'operator-runner-not-certification', sport: state.config.sport,
    phase: state.phase, requests: state.requestCount, pending: state.pending ? { action: state.pending.action, progress: state.pending.progress } : null,
    artifacts: { workout: !!state.artifact?.ids.workout, schedule: !!state.artifact?.ids.schedule },
    observations: state.observations, http: state.requests, failure: state.failure,
    remaining: ['Garmin Connect and designated device verification', 'Provider contract, quota and recovery evidence in #698',
      'Cloud worker, consent and account lifecycle certification', 'Separate production enablement approval'] };
}
