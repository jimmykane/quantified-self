import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import type { WahooTrainingClient, WahooTrainingRequest, WahooTrainingResponse } from '../wahoo/http';

export function wahooFixtureWorkout(): ScheduledWorkoutV1 {
  return { schemaVersion: 1, id: 'w', planId: null, title: 'Intervals', localDate: '2026-10-25', lifecycle: 'planned',
    revision: 1, createdAtMs: 1_700_000_000_000, updatedAtMs: 1_700_000_000_000,
    structure: { version: 1, sport: ActivityTypes.Running, nodes: [
      { kind: 'step', id: 'run', purpose: 'work', ending: { kind: 'time', seconds: 90 }, targets: [] },
    ] } };
}
/** Synthetic, deliberately NON-idempotent POSTs. No real-provider credentials or data. */
export class WahooHttpFixture {
  readonly plans = new Map<string, Record<string, unknown>>();
  readonly workouts = new Map<string, Record<string, unknown>>();
  readonly calls: WahooTrainingRequest[] = [];
  afterHandle: ((request: WahooTrainingRequest) => Promise<void>) | null = null;
  beforeHandle: ((request: WahooTrainingRequest) => Promise<void>) | null = null;
  private sequence = 0;
  request: WahooTrainingClient = async (request, guard) => {
    await guard(); await this.beforeHandle?.(request); this.calls.push(request);
    const response = this.handle(request);
    await this.afterHandle?.(request); return structuredClone(response);
  };
  private handle(request: WahooTrainingRequest): WahooTrainingResponse {
    const url = new URL(request.path, 'https://fixture.test');
    if (request.path.startsWith('/v1/plans?')) return { status: 200,
      body: [...this.plans.values()].filter(plan => plan.external_id === url.searchParams.get('external_id')) };
    if (request.path.startsWith('/v1/workouts?')) {
      const page = Number(url.searchParams.get('page'));
      const workouts = [...this.workouts.values()].sort((a, b) => String(b.starts).localeCompare(String(a.starts)) || String(a.id).localeCompare(String(b.id)));
      return { status: 200, body: { workouts: workouts.slice((page - 1) * 100, page * 100), total: workouts.length,
        page, per_page: 100, order: 'descending', sort: 'starts' } };
    }
    const [, , kind, id, association] = url.pathname.split('/');
    if (association === 'plans') {
      const workout = this.workouts.get(id);
      return { status: 200, body: workout ? [...this.plans.values()].filter(plan => String(plan.id) === String(workout.plan_id)) : [] };
    }
    const rows = kind === 'plans' ? this.plans : this.workouts;
    if (request.method === 'GET') return { status: rows.has(id) ? 200 : 404, body: rows.get(id) ?? null };
    if (request.method === 'DELETE') return { status: rows.delete(id) ? 204 : 404, body: null };
    if (request.method === 'PUT' && !rows.has(id)) return { status: 404, body: null };
    const savedId = request.method === 'POST' ? String(++this.sequence) : id;
    const fields = new URLSearchParams(request.body);
    const prefix = kind === 'plans' ? 'plan' : 'workout';
    const data = Object.fromEntries([...fields].map(([key, value]) => [key.slice(prefix.length + 1, -1), value]));
    let row: Record<string, unknown>;
    if (kind === 'plans') {
      const file = JSON.parse(Buffer.from(data.file.split(',')[1], 'base64').toString());
      row = { ...rows.get(id), id: savedId, user_id: 123, deleted: false, external_id: data.external_id ?? rows.get(id)?.external_id,
        name: file.header.name, workout_type_family_id: file.header.workout_type_family, workout_type_location_id: file.header.workout_type_location,
        provider_updated_at: data.provider_updated_at, fixtureRecipe: file };
    } else {
      row = { plan_ids: [], workout_summary: null, ...rows.get(id), ...data, id: savedId,
        minutes: Number(data.minutes), workout_type_id: Number(data.workout_type_id) };
    }
    rows.set(savedId, row);
    return { status: request.method === 'POST' ? 201 : 200, body: row };
  }
}
