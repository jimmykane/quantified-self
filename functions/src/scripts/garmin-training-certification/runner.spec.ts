import { beforeEach, describe, expect, it } from 'vitest';
import { GarminHttpFixture } from '../../training-plans/delivery/test-support/garmin-http-fixture';
import { GarminTrainingHttpError } from '../../training-plans/delivery/garmin/http';
import { approval, initialState, type Action, type RunState } from './model';
import { CertificationRunner } from './runner';
import type { Authority } from './authority';
import type { Journal } from './journal';

describe('operator certification runner / synthetic Garmin HTTP', () => {
  let state: RunState;
  let authority: Authority;
  let now: number;
  let server: GarminHttpFixture;
  let journal: Journal;
  let runner: CertificationRunner;
  let failSave: ((next: RunState) => boolean) | undefined;
  const restart = () => new CertificationRunner(journal, { authority: async () => structuredClone(authority),
    client: server.request, now: () => now, sleep: async ms => { now += ms; } });
  const run = (action: Action) => runner.execute(action, approval(state, action));
  const posts = () => server.calls.filter(call => call.method === 'POST');
  beforeEach(async () => {
    now = Date.parse('2026-12-20T10:00:00Z');
    state = initialState({ project: 'demo-training-delivery', uid: 'synthetic-user', date: '2026-12-31', timeZone: 'Europe/Helsinki', sport: 'running' });
    authority = { binding: { destinationKey: 'a'.repeat(64), generation: 'g1', epoch: 0 }, accessToken: 'synthetic-only', pro: true };
    server = new GarminHttpFixture(); failSave = undefined;
    journal = { get state() { return structuredClone(state); }, save: async next => {
      if (failSave?.(next)) throw new Error('Synthetic persistence fault');
      state = structuredClone(next);
    } };
    runner = restart();
    await runner.preflight((await runner.preflight()).approval);
  });
  it('previews without HTTP; CRUD keeps exact Long IDs and verifies updates, dates and removal', async () => {
    runner.preview('create'); expect(server.calls).toHaveLength(0);
    await run('create'); const ids = state.artifact!.ids;
    await run('inspect'); await run('create');
    await run('update'); expect(state.artifact!.ids).toEqual(ids);
    await run('inspect'); await run('reschedule'); expect(state.artifact!.ids).toEqual(ids);
    expect(state.artifact!.localDate).toBe('2027-01-01'); await run('inspect');
    const createApproval = approval(state, 'create');
    await expect(runner.execute('remove', createApproval)).rejects.toThrow();
    await run('remove'); await run('inspect');
    expect(state.observations.map(row => row.passed)).toEqual([true, true, true, true]);
    expect(server.workouts.size + server.schedules.size).toBe(0);
    expect(posts()).toHaveLength(2);
    expect(state.requestCount).toBeLessThan(48);
    expect(state.requests.filter(row => row.method === 'POST').map(row => row.status)).toEqual([200, 200]);
    expect(state.requests.filter(row => row.method === 'DELETE').map(row => row.status)).toEqual([204, 204]);
  });
  it('requires current approval and ordered actions', async () => {
    await expect(runner.execute('create', 'bad')).rejects.toThrow();
    await expect(run('update')).rejects.toThrow();
    const stale = approval(state, 'create'); await runner.preflight((await runner.preflight()).approval);
    await expect(runner.execute('create', stale)).rejects.toThrow();
    expect(server.calls).toHaveLength(0);
  });
  it('blocks Pro-less writes but permits separately approved removal', async () => {
    authority.pro = false; await expect(run('create')).rejects.toThrow(); expect(posts()).toHaveLength(0);
    authority.pro = true; await run('create'); authority.pro = false;
    await expect(run('update')).rejects.toThrow();
    await run('remove'); expect(server.workouts.size + server.schedules.size).toBe(0);
  });
  it.each(['account', 'generation', 'disconnect'] as const)('fences %s changes between workout and schedule requests', async change => {
    server.afterHandle = async request => {
      if (request.method !== 'POST') return;
      if (change === 'account') authority.binding.destinationKey = 'b'.repeat(64);
      if (change === 'generation') authority.binding.generation = 'g2';
      if (change === 'disconnect') authority.binding.epoch++;
    };
    await expect(run('create')).rejects.toThrow();
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(0);
    if (change !== 'generation') await expect(runner.preflight()).rejects.toThrow();
    else {
      server.afterHandle = null;
      await runner.preflight((await runner.preflight()).approval);
      await run('create'); expect(posts()).toHaveLength(2);
    }
  });
  it.each(['lost-response', 'lost-checkpoint'] as const)('never repeats an uncertain first POST after %s', async fault => {
    server.afterHandle = async request => {
      if (request.method !== 'POST') return;
      server.afterHandle = null;
      if (fault === 'lost-response') throw new GarminTrainingHttpError('uncertain', false);
      failSave = next => !!next.artifact;
    };
    await expect(run('create')).rejects.toThrow();
    expect(state.pending?.progress?.state).toBe('started');
    failSave = undefined; runner = restart();
    await expect(run('create')).rejects.toThrow();
    await expect(run('remove')).rejects.toThrow();
    expect(posts()).toHaveLength(1); expect(server.workouts.size).toBe(1);
  });
  it('recovers a lost schedule acceptance by exact identity without another POST', async () => {
    server.afterHandle = async request => {
      if (request.method === 'POST' && request.path.includes('schedule')) {
        server.afterHandle = null; throw new GarminTrainingHttpError('uncertain', false);
      }
    };
    await expect(run('create')).rejects.toThrow();
    runner = restart(); await run('create');
    expect(state.phase).toBe('created'); expect(posts()).toHaveLength(2);
  });
  it('retains rate-limit delays across restart, including cleanup', async () => {
    server.beforeHandle = async request => {
      if (request.method === 'POST') { server.beforeHandle = null; throw new GarminTrainingHttpError('retryable', true, 90_000); }
    };
    await expect(run('create')).rejects.toThrow(); runner = restart();
    const count = server.calls.length;
    await expect(run('create')).rejects.toThrow(); await expect(run('remove')).rejects.toThrow();
    expect(server.calls).toHaveLength(count);
    now += 90_001; await run('create'); expect(state.phase).toBe('created');
  });
  it('removes a known partial workout without creating its missing schedule', async () => {
    server.beforeHandle = async request => {
      if (request.method === 'POST' && request.path.includes('schedule')) throw new GarminTrainingHttpError('permission', true);
    };
    await expect(run('create')).rejects.toThrow(); server.beforeHandle = null;
    await run('remove'); expect(server.workouts.size + server.schedules.size).toBe(0);
    expect(posts().filter(call => call.path.includes('workout'))).toHaveLength(1);
  });
  it('will not write to an unrelated QS workout even if its ID is in the private journal', async () => {
    await run('create'); server.workouts.get(state.artifact!.ids.workout)!.workoutName = 'Real user workout';
    const before = server.calls.filter(call => call.method !== 'GET').length;
    await expect(run('remove')).rejects.toThrow();
    expect(server.calls.filter(call => call.method !== 'GET')).toHaveLength(before);
    expect(server.schedules.size).toBe(1);
  });
  it('records a failed read-back without claiming success or repairing remotely', async () => {
    await run('create'); server.schedules.get(state.artifact!.ids.schedule!)!.date = '2027-01-03';
    await expect(run('inspect')).rejects.toThrow(); expect(state.observations[0].passed).toBe(false); expect(state.failure).toBe('uncertain');
  });
  it.each(['past', 'horizon', 'completed'] as const)('fences %s writes', async mode => {
    if (mode === 'completed') { await run('create'); state.artifact!.completed = true; }
    else state.config.date = mode === 'past' ? '2026-12-19' : '2028-01-01';
    const writes = server.calls.filter(call => call.method !== 'GET').length;
    await expect(run(mode === 'completed' ? 'remove' : 'create')).rejects.toThrow();
    expect(server.calls.filter(call => call.method !== 'GET')).toHaveLength(writes);
  });
  it('reserves request budget for cleanup and never exceeds the total cap', async () => {
    await run('create'); state.requestCount = 48;
    await expect(run('update')).rejects.toThrow();
    await run('remove'); expect(state.phase).toBe('removed');
    state.requestCount = 64; await expect(run('inspect')).rejects.toThrow(); expect(state.requestCount).toBe(64);
  });
  it('accepts provider numeric IDs as well as Long strings during read-back', async () => {
    server.nextId = 100n; await run('create');
    const ids = state.artifact!.ids;
    server.workouts.get(ids.workout)!.workoutId = Number(ids.workout);
    server.schedules.get(ids.schedule!)!.scheduleId = Number(ids.schedule);
    server.schedules.get(ids.schedule!)!.workoutId = Number(ids.workout);
    await run('inspect'); expect(state.observations[0].passed).toBe(true);
  });
  it('recovers provider-accepted PUT and DELETE after lost responses without replacement creates', async () => {
    await run('create');
    for (const action of ['update', 'reschedule', 'remove'] as const) {
      server.afterHandle = async request => {
        if (request.method !== (action === 'remove' ? 'DELETE' : 'PUT')) return;
        server.afterHandle = null; throw new GarminTrainingHttpError('uncertain', false);
      };
      await expect(run(action)).rejects.toThrow(); runner = restart(); await run(action);
    }
    expect(state.phase).toBe('removed'); expect(posts()).toHaveLength(2);
  });
  it('paces from request completion even when authority or transport is slow', async () => {
    const starts: number[] = [];
    server.beforeHandle = async () => { starts.push(now); now += 10_000; };
    await run('create'); expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(12_000);
  });
});
