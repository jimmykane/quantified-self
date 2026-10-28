import { parseGarminTrainingJSON, type GarminTrainingClient, type GarminTrainingRequest, type GarminTrainingResponse } from '../garmin/http';

/** Synthetic contract server, test-only and excluded from the Functions build.
 * It models documented shapes, not evidence of Garmin sandbox behavior. */
export class GarminHttpFixture {
  calls: GarminTrainingRequest[] = [];
  workouts = new Map<string, Record<string, unknown>>();
  schedules = new Map<string, Record<string, unknown>>();
  nextId = 9_223_372_036_854_775_000n;
  beforeHandle: ((request: GarminTrainingRequest) => Promise<void>) | null = null;
  afterHandle: ((request: GarminTrainingRequest) => Promise<void>) | null = null;
  request: GarminTrainingClient = async (request, beforeSend) => {
    await beforeSend();
    this.calls.push(request);
    await this.beforeHandle?.(request);
    const response = this.handle(request);
    await this.afterHandle?.(request);
    return response;
  };
  private handle(request: GarminTrainingRequest): GarminTrainingResponse {
    const { path, method } = request;
    const payload = request.body ? parseGarminTrainingJSON(request.body) as Record<string, unknown> : {};
    if (path.startsWith('/training-api/schedule?')) {
      const date = new URL(`https://fixture.invalid${path}`).searchParams.get('startDate');
      return { status: 200, body: [...this.schedules.values()].filter(row => row.date === date) };
    }
    const workouts = path.includes('workout');
    const store = workouts ? this.workouts : this.schedules;
    const key = workouts ? 'workoutId' : 'scheduleId';
    if (method === 'POST') {
      const id = String(this.nextId++);
      const record = { ...payload, [key]: id, ...(workouts ? { ownerId: '9007199254740993' } : {}) };
      store.set(id, record);
      return { status: 200, body: structuredClone(record) };
    }
    const id = path.split('/').pop()!;
    if (!store.has(id)) return { status: 404, body: null };
    if (method === 'GET') return { status: 200, body: structuredClone(store.get(id)) };
    if (method === 'DELETE') { store.delete(id); return { status: 204, body: null }; }
    store.set(id, { ...payload, [key]: id });
    return { status: 204, body: null };
  }
}
