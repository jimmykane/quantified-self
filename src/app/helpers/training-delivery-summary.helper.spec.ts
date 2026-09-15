import { createHash, webcrypto } from 'node:crypto';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1, TrainingPlanV1 } from '@shared/training-plans';
import type { TrainingDeliverySettingsV1, TrainingDeliveryStatusV1 } from '@shared/training-provider-delivery';
import { buildTrainingDeliverySummaries, trainingDeliverySummaryIdentity } from './training-delivery-summary.helper';

const workout = (id: string, changes: Partial<ScheduledWorkoutV1> = {}): ScheduledWorkoutV1 => ({
  schemaVersion: 1, id, planId: 'p', localDate: '2027-01-01', lifecycle: 'planned', title: id, revision: 1,
  createdAtMs: 1, updatedAtMs: 1, structure: { version: 1, sport: ActivityTypes.Running, nodes: [] }, ...changes,
});
const plan: TrainingPlanV1 = { schemaVersion: 1, id: 'p', name: 'Winter', lifecycle: 'active', startLocalDate: '2026-12-01',
  endLocalDate: '2027-03-01', revision: 1, lastCheckpointRevision: 1, workoutCount: 3, createdAtMs: 1, updatedAtMs: 1 };
const setting: TrainingDeliverySettingsV1 = { schemaVersion: 1, scope: 'plan', scopeId: 'p', provider: 'garmin', revision: 1,
  enabled: true, suppressed: false, timeZone: 'Europe/Helsinki', destinationKey: 'safe-account-fingerprint', connectionEpoch: 0,
  scopeGeneration: 0, associationPlanId: null, approvedDigest: null, updatedAtMs: 1 };
const identity = (id: string, destinationKey = setting.destinationKey, provider = setting.provider) =>
  createHash('sha256').update(JSON.stringify(['owner', provider, destinationKey, id])).digest('hex');
const status = (id: string, changes: Partial<TrainingDeliveryStatusV1> = {}): TrainingDeliveryStatusV1 => ({
  schemaVersion: 1, id: identity(id), workoutId: id, planId: 'p', provider: 'garmin', status: 'delivered',
  hasRemoteCopy: true, differsFromQS: false, timeZone: 'Europe/Helsinki', approvalDigest: null, issues: [],
  lastAcceptedAtMs: 2, lastAttemptAtMs: 2, updatedAtMs: 3, retryCount: 0, nextRetryAtMs: null, ...changes,
});
const input = () => ({ uid: 'owner', scope: 'plan' as const, id: 'p', workouts: [workout('a'), workout('b'), workout('c')],
  plan, settings: [setting], statuses: [status('a'), status('b')], complete: true });

describe('Training delivery service summaries', () => {
  beforeEach(() => vi.stubGlobal('crypto', webcrypto));
  afterEach(() => vi.unstubAllGlobals());
  it('matches the server identity framing exactly without exposing an account ID', async () => {
    expect(await trainingDeliverySummaryIdentity('owner', 'garmin', setting.destinationKey, 'a')).toBe(identity('a'));
  });
  it('counts all current plan workouts across dates, not just loaded delivered records', async () => {
    const data = input(); data.workouts[0].localDate = '2026-12-31';
    data.workouts.push(workout('deleted', { lifecycle: 'deleted' }), workout('other-plan', { planId: 'other' }));
    const [row] = await buildTrainingDeliverySummaries(data);
    expect(row.label).toBe('2 of 3 workouts synced'); expect(row.detail).toContain('1 waiting to sync');
    expect(row.icon).not.toBe('check_circle'); expect(row.presentation.displayLabel).toBe('Garmin Connect');
    expect(row.projection).toMatchObject({ totalWorkouts: 3, syncedWorkouts: 2, state: 'current',
      outcomes: [{ status: 'waiting', count: 1 }, { status: 'delivered', count: 2 }] });
  });
  it('never claims native plan or device delivery, even when all workouts are confirmed', async () => {
    const [row] = await buildTrainingDeliverySummaries({ ...input(), statuses: ['a', 'b', 'c'].map(id => status(id)) });
    expect(row.label).toBe('3 of 3 workouts synced'); expect(row.icon).toBe('check_circle');
    expect(JSON.stringify(row)).not.toMatch(/plan synced|device synced|watch synced/i);
  });
  it.each(['failed', 'unsupported', 'approval_required', 'needs_attention', 'reconnect_required', 'connection_repair', 'fresh_consent_required'] as const)(
    'keeps %s visible and does not count its retained copy as synced', async state => {
      const [row] = await buildTrainingDeliverySummaries({ ...input(), statuses: [status('a'), status('b', { status: state, differsFromQS: true })] });
      expect(row.label).toBe('1 of 3 workouts synced'); expect(row.detail).not.toBe(''); expect(row.icon).toBe('error_outline');
    });
  it('does not count a partial first delivery or an older accepted version', async () => {
    const [row] = await buildTrainingDeliverySummaries({ ...input(), statuses: [status('a', { lastAcceptedAtMs: null }), status('b', { differsFromQS: true })] });
    expect(row.label).toBe('0 of 3 workouts synced'); expect(row.detail).toContain('2 delivery unconfirmed');
  });
  it('does not count confirmed missing remote artifacts even though earlier acceptance is retained', async () => {
    const [row] = await buildTrainingDeliverySummaries({ ...input(), statuses: [
      status('a', { hasRemoteCopy: false, differsFromQS: true }), status('b'),
    ] });
    expect(row.label).toBe('1 of 3 workouts synced');
  });
  it('does not double-count earlier accounts or let their success stand in for the new destination', async () => {
    const [row] = await buildTrainingDeliverySummaries({ ...input(), statuses: [status('a'), status('a', { id: identity('a', 'old') }),
      status('b', { id: identity('b', 'old') }), status('removed', { id: identity('removed', 'old') })] });
    expect(row.label).toBe('1 of 3 workouts synced'); expect(row.detail).toContain('3 retained copies from earlier sync');
  });
  it('invalidates confirmations after authored edits, settings changes, transfers or a new workout Stop', async () => {
    const cases = [
      { ...input(), workouts: [workout('a', { updatedAtMs: 10 })] },
      { ...input(), workouts: [workout('a')], settings: [{ ...setting, updatedAtMs: 10 }] },
      { ...input(), workouts: [workout('a')], statuses: [status('a', { planId: 'previous' })] },
      { ...input(), workouts: [workout('a')], settings: [setting, { ...setting, scope: 'workout' as const, scopeId: 'a', associationPlanId: 'p', suppressed: true, updatedAtMs: 10 }] },
    ];
    for (const data of cases) {
      const [row] = await buildTrainingDeliverySummaries(data);
      expect(row.label).toBe('0 of 1 workout synced'); expect(row.detail).toContain('awaiting latest check');
      expect(row.projection).toMatchObject({ syncedWorkouts: 0, differsFromQS: null,
        outcomes: [{ status: 'awaiting_latest_check', count: 1 }] });
    }
  });
  it('distinguishes stopped, skipped, inactive, Pro-paused, horizon and removed states', async () => {
    const states = ['stopped', 'paused_pro', 'outside_horizon', 'removed', 'provider_unavailable', 'retrying', 'paused_plan'] as const;
    const [row] = await buildTrainingDeliverySummaries({ ...input(), workouts: states.map(id => workout(id)),
      statuses: states.map(id => status(id, { status: id, hasRemoteCopy: id !== 'removed' })) });
    expect(row.label).toBe('0 of 7 workouts synced');
    for (const phrase of ['removal pending', 'pro required', 'scheduled for later', 'copy removed', 'delivery unavailable', 'retry scheduled']) expect(row.detail).toContain(phrase);
    const [inactive] = await buildTrainingDeliverySummaries({ ...input(), plan: { ...plan, lifecycle: 'paused' } });
    expect(inactive.label).toBe('Plan inactive · 0 of 3 workouts synced');
    const [skipped] = await buildTrainingDeliverySummaries({ ...input(), workouts: [workout('a', { lifecycle: 'skipped' })] });
    expect(skipped.detail).toContain('skipped'); expect(skipped.icon).not.toBe('check_circle');
    const [off] = await buildTrainingDeliverySummaries({ ...input(), settings: [{ ...setting, enabled: false }] });
    expect(off.label).toContain('Sync off'); expect(off.label).toContain('0 of 3');
  });
  it('retains confirmed past/completed copies without claiming that they will be updated', async () => {
    const [row] = await buildTrainingDeliverySummaries({ ...input(), statuses: [status('a', { status: 'past' }), status('b', { status: 'completed' })] });
    expect(row.label).toBe('2 of 3 workouts synced'); expect(row.detail).toContain('left unchanged');
  });
  it('shows an empty enabled plan as empty, never fully synced', async () => {
    const [row] = await buildTrainingDeliverySummaries({ ...input(), workouts: [], statuses: [] });
    expect(row.label).toBe('Sync enabled · no workouts'); expect(row.icon).not.toBe('check_circle');
  });
  it('withholds totals when the bounded projection read is incomplete', async () => {
    const [row] = await buildTrainingDeliverySummaries({ ...input(), complete: false });
    expect(row.label).toBe('Status incomplete'); expect(row.detail).toContain('not a complete plan total');
    expect(row.projection).toMatchObject({ state: 'incomplete', syncedWorkouts: null, totalWorkouts: null,
      retainedCopies: null, differsFromQS: null, outcomes: [] });
  });
  it('supports 400 current workouts across four providers without turning record count into workout count', async () => {
    const providers = ['garmin', 'coros', 'wahoo', 'suunto'] as const;
    const workouts = Array.from({ length: 400 }, (_, index) => workout(`w-${index}`));
    const rows = await buildTrainingDeliverySummaries({ ...input(), workouts,
      settings: providers.map(provider => ({ ...setting, provider })), statuses: providers.flatMap(provider => workouts.map(workout =>
        status(workout.id, { provider, id: identity(workout.id, setting.destinationKey, provider) }))) });
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.label).toBe('400 of 400 workouts synced');
  });
  it('inherits plan settings for a workout but does not enroll standalone copies or transferred workouts', async () => {
    const data = { ...input(), scope: 'workout' as const, id: 'a', workouts: [workout('a')], statuses: [status('a')] };
    expect((await buildTrainingDeliverySummaries(data))[0].label).toBe('Synced');
    expect(await buildTrainingDeliverySummaries({ ...data, id: 'copy', workouts: [workout('copy', { planId: null })], statuses: [] })).toEqual([]);
    const [transferred] = await buildTrainingDeliverySummaries({ ...data, plan: null, workouts: [workout('a', { planId: null })] });
    expect(transferred.label).toBe('Earlier provider copy'); expect(transferred.detail).toContain('earlier sync');
  });
  it('never promises removal of skipped past/completed workouts', async () => {
    for (const protectedStatus of ['past', 'completed'] as const) {
      const [row] = await buildTrainingDeliverySummaries({ ...input(), workouts: [workout('a', { lifecycle: 'skipped' })],
        statuses: [status('a', { status: protectedStatus })] });
      expect(row.label).toBe('0 of 1 workout synced'); expect(row.detail).toContain('left unchanged'); expect(row.detail).not.toContain('removal pending');
    }
  });
  it('does not label an unconfirmed earlier artifact as previously synced or an extant copy as removed', async () => {
    const [earlier] = await buildTrainingDeliverySummaries({ ...input(), scope: 'workout', id: 'a', plan: null,
      workouts: [workout('a', { planId: null })], settings: [], statuses: [status('a', { lastAcceptedAtMs: null, status: 'needs_attention' })] });
    expect(earlier.label).toBe('Earlier provider copy'); expect(earlier.detail).toContain('needs attention');
    const [removed] = await buildTrainingDeliverySummaries({ ...input(), workouts: [workout('a')], statuses: [status('a', { status: 'removed' })] });
    expect(removed.detail).toContain('removal unconfirmed');
  });
});
