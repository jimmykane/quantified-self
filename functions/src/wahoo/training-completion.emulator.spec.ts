import { createHash, randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { ActivityTypes, ServiceNames } from '@sports-alliance/sports-lib';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { deliveryIdentity } from '../training-plans/delivery/intent';
import { DELIVERY_LEDGER, type DeliveryLedgerV1 } from '../training-plans/delivery/contracts';
import { WAHOO_API_SCOPES } from './constants';
import { retainWahooTrainingCompletion } from './training-completion';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'Wahoo exact Training completion correlation with real Firestore',
  { timeout: 30_000 },
  () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback required');
    const db = new Firestore({ projectId: 'demo-training-wahoo-completion' });
    const users: string[] = [];
    const account = '123';
    const workoutId = '456';
    const planId = '789';
    const workoutToken = `qs-workout-${'a'.repeat(43)}`;
    let uid: string;
    let destinationKey: string;
    const user = () => db.collection('users').doc(uid);
    const accountGuard = () => ({
      providerUserId: account,
      connectionStateGeneration: 'connection',
      activeCredentialGeneration: 'credential',
      credential: null,
    });
    const retain = (overrides: Partial<{
      eventId: string;
      workoutId: string;
      planId: string;
      workoutToken: string;
      workoutSummaryId: string;
    }> = {}) => retainWahooTrainingCompletion(
      db,
      uid,
      overrides.eventId ?? 'event',
      accountGuard(),
      overrides.workoutId ?? workoutId,
      overrides.planId ?? planId,
      overrides.workoutToken ?? workoutToken,
      overrides.workoutSummaryId ?? '999',
      [{ id: 'activity', startTimeMs: Date.parse('2026-09-17T07:00:00Z') }],
      Date.parse('2026-09-17T08:00:00Z'),
    );

    async function seedLedger(id = 'delivery', scheduledWorkoutId = 'workout', completed = false): Promise<void> {
      const ledger: DeliveryLedgerV1 = {
        schemaVersion: 1,
        id,
        workoutId: scheduledWorkoutId,
        planId: 'plan',
        provider: 'wahoo',
        destinationKey,
        desiredGeneration: 1,
        connectionEpoch: 0,
        settingsRevision: 1,
        desiredDigest: 'desired',
        desired: completed ? 'preserve' : 'present',
        status: completed ? 'completed' : 'delivered',
        timeZone: 'Europe/Helsinki',
        issues: [],
        approvalDigest: null,
        actual: {
          ids: {
            plan: planId,
            workout: workoutId,
            externalId: `qs-plan-${'a'.repeat(43)}`,
            workoutToken,
            association: `${workoutId}:${planId}`,
          },
          localDate: '2026-09-17',
          completed,
        },
        acceptedDigest: 'desired',
        contentDigest: 'content',
        acceptedContentDigest: 'content',
        attempt: null,
        lease: null,
        retries: 0,
        retryAtMs: 0,
        blockedConnectionGeneration: null,
        lastAttemptAtMs: 1,
        lastAcceptedAtMs: 1,
        updatedAtMs: 1,
      };
      await user().collection(DELIVERY_LEDGER).doc(id).set(ledger);
    }

    beforeEach(async () => {
      uid = `wahoo-completion-${randomUUID()}`;
      users.push(uid);
      destinationKey = deliveryIdentity(uid, 'wahoo', account, 'account');
      await user().set({ test: true });
      await user().collection('meta').doc(ServiceNames.WahooAPI).set({
        connectionState: 'connected',
        connectionStateGeneration: 'connection',
        providerUserId: account,
      });
      const root = db.collection('wahooAPIAccessTokens').doc(uid);
      await root.set({ activeOAuthCredentialGeneration: 'credential' });
      await root.collection('tokens').doc(account).set({
        serviceName: ServiceNames.WahooAPI,
        wahooUserID: account,
        tokenCredentialGeneration: 'credential',
        scope: WAHOO_API_SCOPES,
      });
      await user().collection('events').doc('event').set({ test: true });
      await user().collection('scheduledWorkouts').doc('workout').set({
        schemaVersion: 1,
        id: 'workout',
        planId: 'plan',
        title: 'Wahoo run',
        localDate: '2026-09-17',
        revision: 2,
        lifecycle: 'planned',
        createdAtMs: 1,
        updatedAtMs: 2,
        structure: {
          version: 1,
          sport: ActivityTypes.Running,
          nodes: [{ kind: 'step', id: 'step', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] }],
        },
      });
      await seedLedger();
    });

    afterAll(async () => {
      for (const id of users) {
        await db.recursiveDelete(db.collection('users').doc(id));
        await db.recursiveDelete(db.collection('wahooAPIAccessTokens').doc(id));
        await db.recursiveDelete(db.collection('userDeletionTombstones').doc(id));
      }
      await db.terminate();
    });

    it('links the exact delivered identifiers and is idempotent', async () => {
      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: ['workout'] });
      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: ['workout'] });
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).data()).toMatchObject({
        provider: 'wahoo',
        matchMethod: 'provider_marker',
        eventId: 'event',
        activityId: 'activity',
        workoutRevisionAtLink: 2,
        timing: 'on_date',
      });
      expect((await user().collection(DELIVERY_LEDGER).doc('delivery').get()).data()).toMatchObject({
        status: 'completed',
        desired: 'preserve',
        completionLinkId: expect.any(String),
        actual: { completed: true },
      });
      expect((await user().collection('events').doc('event')
        .collection('trainingCompletionEvidence').doc('wahoo').get()).data()).toMatchObject({
        sourceProvider: 'wahoo',
        workoutId,
        planId,
        workoutSummaryId: '999',
        workoutTokenDigest: createHash('sha256').update(workoutToken).digest('hex'),
        outcome: 'already_linked',
      });
    });

    it('adds the activity link when provider inspection already protected the copy', async () => {
      await user().collection(DELIVERY_LEDGER).doc('delivery').delete();
      await seedLedger('delivery', 'workout', true);

      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: ['workout'] });
      expect((await user().collection(DELIVERY_LEDGER).doc('delivery').get()).data())
        .toMatchObject({ status: 'completed', actual: { completed: true } });
      expect((await user().collection(DELIVERY_LEDGER).doc('delivery').get()).data()?.completionLinkId).toBeFalsy();
    });

    it('fails closed for mismatched or collided delivery identities', async () => {
      expect(await retain({ workoutToken: `qs-workout-${'b'.repeat(43)}` }))
        .toEqual({ retained: true, linkedWorkoutIds: [] });
      expect((await user().collection('events').doc('event')
        .collection('trainingCompletionEvidence').doc('wahoo').get()).data()).toMatchObject({ outcome: 'conflict' });

      await user().collection('scheduledWorkouts').doc('other-workout').set({
        ...(await user().collection('scheduledWorkouts').doc('workout').get()).data(),
        id: 'other-workout',
      });
      await seedLedger('other-delivery', 'other-workout');
      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: [] });
      expect((await user().collection('events').doc('event')
        .collection('trainingCompletionEvidence').doc('wahoo').get()).data()).toMatchObject({ outcome: 'conflict' });
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
    });

    it('defers during delivery changes and rejects stale account authority', async () => {
      await user().collection(DELIVERY_LEDGER).doc('delivery').update({ lease: { id: 'lease', expiresAtMs: Date.now() + 60_000 } });
      await expect(retain()).rejects.toThrow('delivery is changing');
      await user().collection(DELIVERY_LEDGER).doc('delivery').update({ lease: null });
      await db.collection('wahooAPIAccessTokens').doc(uid).update({ activeOAuthCredentialGeneration: 'replacement' });
      expect(await retain()).toEqual({ retained: false, linkedWorkoutIds: [] });
    });

    it('does not retain evidence for malformed identifiers or a missing event', async () => {
      expect(await retain({ workoutId: '0' })).toEqual({ retained: false, linkedWorkoutIds: [] });
      await user().collection('events').doc('event').delete();
      expect(await retain()).toEqual({ retained: false, linkedWorkoutIds: [] });
      expect((await user().collection('events').doc('event').collection('trainingCompletionEvidence').get()).empty).toBe(true);
    });
  },
);
