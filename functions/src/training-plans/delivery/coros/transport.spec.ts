import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import type { DeliveryOperation } from '../contracts';
import { projectStrengthWorkoutToV1 } from '../../../../../shared/strength-workout';
import { CorosTrainingTransport } from './transport';

const NOW = Date.parse('2026-09-17T10:00:00Z');

function workout(index: number, date = `2026-09-${String(18 + index).padStart(2, '0')}`): ScheduledWorkoutV1 {
  return { schemaVersion: 1, id: `workout-${index}`, planId: index % 2 ? 'plan' : null, title: `Workout ${index}`,
    localDate: date, lifecycle: 'planned', revision: 1, createdAtMs: NOW, updatedAtMs: NOW + index,
    structure: { version: 1, sport: ActivityTypes.Running, nodes: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] },
    ] } };
}

function operations(count: number, kind: 'upsert' | 'remove', transport: CorosTrainingTransport): DeliveryOperation[] {
  return Array.from({ length: count }, (_, index) => {
    const current = workout(index, new Date(Date.UTC(2026, 8, 18 + index)).toISOString().slice(0, 10));
    const digest = transport.assess(current, 'destination', 'Europe/Helsinki').digest;
    return { id: `operation-${index}`, kind, deliveryId: `delivery-${index}`, generation: 1,
      connectionGeneration: 'connection', destinationKey: 'destination', timeZone: 'Europe/Helsinki',
      digest, contentDigest: `content-${index}`, workout: kind === 'upsert' ? current : null,
      artifact: kind === 'remove' ? { ids: { workout: String(1000 + index), athlete: '55' },
        localDate: current.localDate, completed: false } : null,
      progress: null, providerIdentity: { athleteId: 55, workoutId: 1000 + index } };
  });
}

describe('COROS Training batch transport', () => {
  const strengthOperation = (operation: DeliveryOperation, transport: CorosTrainingTransport) => {
    const strength = { version: 1 as const, workoutId: operation.workout!.id, revision: 1, exercises: [{ id: 'squat', name: 'Squat',
      sets: [{ id: 'set', ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80.25, restAfterSeconds: 60 }] }] };
    operation.strength = strength;
    operation.workout = { ...operation.workout!, structure: projectStrengthWorkoutToV1(strength) };
    operation.digest = transport.assess(operation.workout, operation.destinationKey, operation.timeZone, strength).digest;
  };

  it('sends mixed running and full-strength workouts in the same 30-item batch', async () => {
    const client = vi.fn(async (request: { data?: string }, beforeSend: () => Promise<void>) => {
      await beforeSend(); const payload = JSON.parse(request.data!);
      return { status: 200, body: { result: '0000', data: { StartDate: payload.StartDate, EndDate: payload.EndDate } } };
    });
    const transport = new CorosTrainingTransport(client, () => NOW);
    const batch = operations(30, 'upsert', transport);
    for (let i = 0; i < batch.length; i += 2) strengthOperation(batch[i], transport);
    await expect(transport.batch.execute(batch, async () => {}, async () => {})).resolves.toHaveLength(30);
    const payload = JSON.parse(client.mock.calls[0][0].data!);
    expect(payload.Workouts.filter((value: { WorkoutType: string }) => value.WorkoutType === 'strength')).toHaveLength(15);
    expect(payload.Workouts[0]).toMatchObject({ Id: 1000, Structure: [{ Length: { Unit: 'Reps', Value: 5 },
      Rest: { Unit: 'Second', Value: 60 }, IntensityTarget: { Unit: 'ValueOfEquipmentWeight', Value: 80.25 } }] });
  });

  it.each(['missing', 'foreign', 'mismatch', 'invalid', 'stale-load'] as const)(
    'rejects %s strength before HTTP or the started journal', async failure => {
      const client = vi.fn(); const beforeSend = vi.fn();
      const transport = new CorosTrainingTransport(client, () => NOW);
      const batch = operations(1, 'upsert', transport);
      strengthOperation(batch[0], transport);
      if (failure === 'missing') batch[0].strength = undefined;
      if (failure === 'foreign') batch[0].strength!.workoutId = 'foreign';
      if (failure === 'mismatch') batch[0].strength!.exercises[0].name = 'Different';
      if (failure === 'invalid') batch[0].strength!.exercises[0].sets[0].externalLoadKg = -1;
      if (failure === 'stale-load') batch[0].strength!.exercises[0].sets[0].externalLoadKg = 81;
      await expect(transport.batch.execute(batch, beforeSend, async () => {})).rejects.toMatchObject({ kind: 'terminal', rejected: true });
      expect(client).not.toHaveBeenCalled(); expect(beforeSend).not.toHaveBeenCalled();
    });
  it.each([1, 30])('pushes %s workouts with one stable athlete and accepted range coverage', async count => {
    const client = vi.fn(async (request: { data?: string }, beforeSend: () => Promise<void>) => {
      await beforeSend();
      const payload = JSON.parse(request.data!);
      return { status: 200, body: { result: '0000', message: 'OK', data: {
        StartDate: payload.StartDate.replaceAll('-', ''), EndDate: payload.EndDate.replaceAll('-', ''),
      } } };
    });
    const transport = new CorosTrainingTransport(client, () => NOW);
    const batch = operations(count, 'upsert', transport);
    const beforeSend = vi.fn(async () => {});
    const guard = vi.fn(async () => {});
    const outcomes = await transport.batch.execute(batch, beforeSend, guard);
    expect(outcomes).toHaveLength(count);
    expect(outcomes.every(outcome => outcome.state === 'accepted')).toBe(true);
    expect(beforeSend).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(client.mock.calls[0][0].data!);
    expect(payload.Workouts).toHaveLength(count);
    expect(payload.AthleteId).toBe(55);
    expect(payload.Workouts.every((entry: { WorkoutType: string }) => entry.WorkoutType === 'run')).toBe(true);
    expect(new Set(payload.Workouts.map((entry: { Id: number }) => entry.Id)).size).toBe(count);
    expect(payload.Workouts.map((entry: { WorkoutDay: string }) => entry.WorkoutDay)).toEqual(
      [...payload.Workouts].map((entry: { WorkoutDay: string }) => entry.WorkoutDay).sort());
  });

  it('rejects a 31-workout request before HTTP', async () => {
    const client = vi.fn();
    const transport = new CorosTrainingTransport(client, () => NOW);
    await expect(transport.batch.execute(operations(31, 'upsert', transport), async () => {}, async () => {}))
      .rejects.toMatchObject({ kind: 'terminal', rejected: true });
    expect(client).not.toHaveBeenCalled();
  });

  it('protects past and provider-confirmed completed copies from deletion', async () => {
    const client = vi.fn();
    const transport = new CorosTrainingTransport(client, () => NOW);
    const past = operations(1, 'remove', transport);
    past[0].artifact = { ...past[0].artifact!, localDate: '2026-09-16' };
    past[0].allowPastRemoval = true;
    await expect(transport.batch.execute(past, async () => {}, async () => {}))
      .rejects.toMatchObject({ kind: 'terminal', rejected: true });
    const completed = operations(1, 'remove', transport);
    completed[0].artifact = { ...completed[0].artifact!, completed: true };
    await expect(transport.batch.execute(completed, async () => {}, async () => {}))
      .rejects.toMatchObject({ kind: 'terminal', rejected: true });
    expect(client).not.toHaveBeenCalled();
  });

  it('fails closed when retained artifact IDs disagree with the stable identity mapping', async () => {
    const client = vi.fn();
    const transport = new CorosTrainingTransport(client, () => NOW);
    const removal = operations(1, 'remove', transport);
    removal[0].artifact = { ...removal[0].artifact!, ids: { workout: '9999', athlete: '55' } };
    await expect(transport.batch.execute(removal, async () => {}, async () => {}))
      .rejects.toMatchObject({ kind: 'terminal', rejected: true });
    const update = operations(1, 'upsert', transport);
    update[0].artifact = { ids: { workout: '9999', athlete: '55' },
      localDate: update[0].workout!.localDate, completed: false };
    await expect(transport.batch.execute(update, async () => {}, async () => {}))
      .rejects.toMatchObject({ kind: 'terminal', rejected: true });
    expect(client).not.toHaveBeenCalled();
  });

  it('uses the saved zone across a DST boundary and enforces the 365-day horizon', async () => {
    const dstNow = Date.parse('2026-03-28T22:30:00Z'); // 2026-03-29 in Europe/Helsinki.
    const client = vi.fn(async (request: { data?: string }, beforeSend: () => Promise<void>) => {
      await beforeSend();
      const payload = JSON.parse(request.data!);
      return { status: 200, body: { result: '0000', data: {
        StartDate: payload.StartDate.replaceAll('-', ''), EndDate: payload.EndDate.replaceAll('-', ''),
      } } };
    });
    const transport = new CorosTrainingTransport(client, () => dstNow);
    const atHorizon = operations(1, 'upsert', transport);
    atHorizon[0].workout = workout(0, '2027-03-29');
    atHorizon[0].digest = transport.assess(atHorizon[0].workout, 'destination', 'Europe/Helsinki').digest;
    await expect(transport.batch.execute(atHorizon, async () => {}, async () => {}))
      .resolves.toHaveLength(1);
    const beyondHorizon = operations(1, 'upsert', transport);
    beyondHorizon[0].workout = workout(0, '2027-03-30');
    beyondHorizon[0].digest = transport.assess(beyondHorizon[0].workout, 'destination', 'Europe/Helsinki').digest;
    await expect(transport.batch.execute(beyondHorizon, async () => {}, async () => {}))
      .rejects.toMatchObject({ kind: 'terminal' });
  });

  it('requires the accepted range to cover every submitted workout', async () => {
    const client = vi.fn(async (_request, beforeSend: () => Promise<void>) => {
      await beforeSend();
      return { status: 200, body: { result: '0000', data: { StartDate: 20260919, EndDate: 20260919 } } };
    });
    const transport = new CorosTrainingTransport(client, () => NOW);
    await expect(transport.batch.execute(operations(2, 'upsert', transport), async () => {}, async () => {}))
      .rejects.toMatchObject({ kind: 'uncertain' });
  });

  it('partitions delete success, failure, missing and conflicting outcomes per workout', async () => {
    const client = vi.fn(async (_request, beforeSend: () => Promise<void>) => {
      await beforeSend();
      return { status: 200, body: { result: '0000', data: {
        successIdList: [1000, 1002, 1002], failIdList: [1001, 1002],
      } } };
    });
    const transport = new CorosTrainingTransport(client, () => NOW);
    const outcomes = await transport.batch.execute(operations(4, 'remove', transport), async () => {}, async () => {});
    expect(outcomes.map(outcome => outcome.state)).toEqual(['accepted', 'rejected', 'unresolved', 'unresolved']);
    expect(outcomes[0].artifact).toBeNull();
    expect(outcomes.slice(1).every(outcome => outcome.artifact !== null)).toBe(true);
  });

  it('treats delete outcomes for unknown IDs as an uncertain acknowledgement', async () => {
    const client = vi.fn(async (_request, beforeSend: () => Promise<void>) => {
      await beforeSend();
      return { status: 200, body: { result: '0000', data: { successIdList: [1000, 9999], failIdList: [] } } };
    });
    const transport = new CorosTrainingTransport(client, () => NOW);
    await expect(transport.batch.execute(operations(1, 'remove', transport), async () => {}, async () => {}))
      .rejects.toMatchObject({ kind: 'uncertain' });
  });

  it.each([
    ['30009', 'provider_access'],
    ['5006', 'auth'],
    ['5001', 'terminal'],
  ] as const)('maps provider result %s to %s without inventing retry policy', async (result, kind) => {
    const client = vi.fn(async (_request, beforeSend: () => Promise<void>) => {
      await beforeSend(); return { status: 200, body: { result, message: 'redacted' } };
    });
    const transport = new CorosTrainingTransport(client, () => NOW);
    await expect(transport.batch.execute(operations(1, 'upsert', transport), async () => {}, async () => {}))
      .rejects.toMatchObject({ kind });
  });
});
