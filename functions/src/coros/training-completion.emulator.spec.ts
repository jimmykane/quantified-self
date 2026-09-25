import { createHash, randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { ActivityTypes, ServiceNames } from '@sports-alliance/sports-lib';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DELIVERY_LEDGER, type DeliveryLedgerV1 } from '../training-plans/delivery/contracts';
import { deliveryIdentity } from '../training-plans/delivery/intent';
import { retainCOROSTrainingCompletion } from './training-completion';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'COROS exact Training completion correlation with real Firestore',
  { timeout: 30_000 },
  () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback required');
    const db = new Firestore({ projectId: 'demo-training-coros-completion' });
    const users: string[] = [];
    let uid: string;
    let destinationKey: string;
    const account = 'coros-account';
    const marker = '123456789';
    const user = () => db.collection('users').doc(uid);
    const retain = (overrides: Partial<{
      account: string;
      tokenDocumentId: string;
      tokenCredentialGeneration: string | null;
      marker: string;
      componentKey: string;
    }> = {}) => retainCOROSTrainingCompletion(
      db,
      uid,
      'event',
      overrides.account ?? account,
      overrides.tokenDocumentId ?? account,
      overrides.tokenCredentialGeneration ?? null,
      overrides.marker ?? marker,
      overrides.componentKey ?? 'root',
      [{ id: 'activity', startTimeMs: Date.parse('2026-09-17T07:00:00Z') }],
      Date.parse('2026-09-17T08:00:00Z'),
    );

    async function seedLedger(id = 'delivery', workoutId = 'workout'): Promise<void> {
      const ledger: DeliveryLedgerV1 = {
        schemaVersion: 1,
        id,
        workoutId,
        planId: 'plan',
        provider: 'coros',
        destinationKey,
        desiredGeneration: 1,
        connectionEpoch: 0,
        settingsRevision: 1,
        desiredDigest: 'desired',
        desired: 'present',
        status: 'delivered',
        timeZone: 'Europe/Helsinki',
        issues: [],
        approvalDigest: null,
        actual: { ids: { workout: marker, athlete: '987654321' }, localDate: '2026-09-17', completed: false },
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
      uid = `coros-completion-${randomUUID()}`;
      users.push(uid);
      destinationKey = deliveryIdentity(uid, 'coros', account, 'account');
      await user().set({ test: true });
      await user().collection('meta').doc(ServiceNames.COROSAPI).set({
        connectionState: 'connected',
        connectionStateGeneration: 'connection',
        providerUserId: account,
      });
      const root = db.collection('COROSAPIAccessTokens').doc(uid);
      await root.set({ connected: true });
      await root.collection('tokens').doc(account).set({
        serviceName: ServiceNames.COROSAPI,
        openId: account,
        accessToken: 'fixture-token',
      });
      await user().collection('events').doc('event').set({ test: true });
      await user().collection('scheduledWorkouts').doc('workout').set({
        schemaVersion: 1,
        id: 'workout',
        planId: 'plan',
        title: 'COROS run',
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
        await db.recursiveDelete(db.collection('COROSAPIAccessTokens').doc(id));
        await db.recursiveDelete(db.collection('userDeletionTombstones').doc(id));
      }
      await db.terminate();
    });

    it('links the exact marker under absent generation metadata and is idempotent', async () => {
      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: ['workout'] });
      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: ['workout'] });
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).data()).toMatchObject({
        provider: 'coros',
        matchMethod: 'provider_marker',
        eventId: 'event',
        activityId: 'activity',
        sourceSessionIndex: null,
        workoutRevisionAtLink: 2,
      });
      expect((await user().collection(DELIVERY_LEDGER).doc('delivery').get()).data()).toMatchObject({
        status: 'completed',
        desired: 'preserve',
        completionLinkId: expect.any(String),
        actual: { completed: true },
      });
      expect((await user().collection('events').doc('event').collection('trainingCompletionEvidence').doc('coros').get()).data())
        .toMatchObject({ sourceProvider: 'coros', planWorkoutId: marker, componentKey: 'root', outcome: 'already_linked' });
      await user().collection('scheduledWorkouts').doc('workout').update({ localDate: '2026-09-18', revision: 3 });
      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: ['workout'] });
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).data())
        .toMatchObject({ scheduledLocalDate: '2026-09-17', workoutRevisionAtLink: 2 });
    });

    it('uses a started reserved identity to resolve an ambiguous first send', async () => {
      const workout = (await user().collection('scheduledWorkouts').doc('workout').get()).data();
      const attemptId = randomUUID();
      await user().collection(DELIVERY_LEDGER).doc('delivery').update({
        actual: null,
        acceptedDigest: null,
        acceptedContentDigest: null,
        status: 'needs_attention',
        issues: ['The COROS batch outcome could not be confirmed.'],
        attempt: {
          id: attemptId,
          kind: 'upsert',
          deliveryId: 'delivery',
          generation: 1,
          connectionGeneration: 'connection',
          destinationKey,
          timeZone: 'Europe/Helsinki',
          digest: 'reserved-desired',
          contentDigest: 'reserved-content',
          workout,
          artifact: null,
          progress: { version: 1, step: 'batch-upsert', state: 'started' },
          providerIdentity: { athleteId: 987654321, workoutId: Number(marker) },
          batchId: randomUUID(),
        },
      });
      await user().collection(DELIVERY_LEDGER).doc('delivery').collection('attempts').doc(attemptId).set({
        schemaVersion: 1,
        state: 'uncertain',
      });

      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: ['workout'] });
      expect((await user().collection(DELIVERY_LEDGER).doc('delivery').get()).data()).toMatchObject({
        status: 'completed',
        desired: 'preserve',
        actual: { ids: { workout: marker, athlete: '987654321' }, completed: true },
        acceptedDigest: 'reserved-desired',
        acceptedContentDigest: 'reserved-content',
        attempt: null,
        lease: null,
      });
      expect((await user().collection(DELIVERY_LEDGER).doc('delivery')
        .collection('attempts').doc(attemptId).get()).data()).toMatchObject({
        state: 'accepted',
        resolution: 'completion_marker',
      });
    });

    it('does not resolve a reserved identity before a provider request started', async () => {
      const workout = (await user().collection('scheduledWorkouts').doc('workout').get()).data();
      await user().collection(DELIVERY_LEDGER).doc('delivery').update({
        actual: null,
        status: 'needs_attention',
        attempt: {
          id: randomUUID(),
          kind: 'upsert',
          deliveryId: 'delivery',
          generation: 1,
          connectionGeneration: 'connection',
          destinationKey,
          timeZone: 'Europe/Helsinki',
          digest: 'reserved-desired',
          contentDigest: 'reserved-content',
          workout,
          artifact: null,
          progress: null,
          providerIdentity: { athleteId: 987654321, workoutId: Number(marker) },
          batchId: randomUUID(),
        },
      });

      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: [] });
      expect((await user().collection('events').doc('event')
        .collection('trainingCompletionEvidence').doc('coros').get()).data()).toMatchObject({ outcome: 'missing' });
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
    });

    it('accepts matching generation metadata and rejects stale authority', async () => {
      const root = db.collection('COROSAPIAccessTokens').doc(uid);
      await root.update({ activeOAuthCredentialGeneration: 'generation' });
      await root.collection('tokens').doc(account).update({ tokenCredentialGeneration: 'generation' });
      expect(await retain({ tokenCredentialGeneration: 'generation' })).toMatchObject({ linkedWorkoutIds: ['workout'] });

      await user().collection('trainingWorkoutCompletions').doc('workout').delete();
      await user().collection('trainingActivityCompletionLinks').get().then(snapshot =>
        Promise.all(snapshot.docs.map(document => document.ref.delete())));
      await root.collection('tokens').doc(account).update({ tokenCredentialGeneration: 'changed' });
      expect(await retain({ tokenCredentialGeneration: 'generation' })).toEqual({ retained: false, linkedWorkoutIds: [] });
    });

    it('rejects cross-account, non-root and invalid provider markers without evidence', async () => {
      expect(await retain({ account: 'another-account' })).toEqual({ retained: false, linkedWorkoutIds: [] });
      expect(await retain({ componentKey: 'component-1' })).toEqual({ retained: false, linkedWorkoutIds: [] });
      expect(await retain({ marker: '9223372036854775807' })).toEqual({ retained: false, linkedWorkoutIds: [] });
      expect((await user().collection('events').doc('event').collection('trainingCompletionEvidence').get()).empty).toBe(true);
    });

    it('retains a valid but unknown marker only as unlinked evidence', async () => {
      expect(await retain({ marker: '123456788' })).toEqual({ retained: true, linkedWorkoutIds: [] });
      expect((await user().collection('events').doc('event').collection('trainingCompletionEvidence').doc('coros').get()).data())
        .toMatchObject({ outcome: 'missing' });
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
    });

    it('does not choose between collided ledger identities', async () => {
      await user().collection('scheduledWorkouts').doc('other-workout').set({
        ...(await user().collection('scheduledWorkouts').doc('workout').get()).data(),
        id: 'other-workout',
      });
      await seedLedger('other-delivery', 'other-workout');
      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: [] });
      expect((await user().collection('events').doc('event').collection('trainingCompletionEvidence').doc('coros').get()).data())
        .toMatchObject({ outcome: 'conflict' });
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
    });

    it('keeps the first exact event when the same marker is reused by another event', async () => {
      expect(await retain()).toMatchObject({ linkedWorkoutIds: ['workout'] });
      await user().collection('events').doc('other-event').set({ test: true });
      const second = await retainCOROSTrainingCompletion(db, uid, 'other-event', account, account, null,
        marker, 'root', [{ id: 'other-activity', startTimeMs: Date.parse('2026-09-17T07:00:00Z') }]);
      expect(second).toEqual({ retained: true, linkedWorkoutIds: [] });
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).data())
        .toMatchObject({ eventId: 'event', activityId: 'activity' });
    });

    it('accepts a same-account reconnect generation but never reads another owner ledger', async () => {
      const root = db.collection('COROSAPIAccessTokens').doc(uid);
      await root.update({ activeOAuthCredentialGeneration: 'reconnected' });
      await root.collection('tokens').doc(account).update({ tokenCredentialGeneration: 'reconnected' });
      expect(await retain({ tokenCredentialGeneration: 'reconnected' })).toMatchObject({ linkedWorkoutIds: ['workout'] });
      const otherUid = `coros-completion-${randomUUID()}`; users.push(otherUid);
      const other = db.collection('users').doc(otherUid);
      await other.set({ test: true });
      await other.collection('meta').doc(ServiceNames.COROSAPI).set({ connectionState: 'connected',
        connectionStateGeneration: 'connection', providerUserId: account });
      await db.collection('COROSAPIAccessTokens').doc(otherUid).set({ connected: true });
      await db.collection('COROSAPIAccessTokens').doc(otherUid).collection('tokens').doc(account).set({
        serviceName: ServiceNames.COROSAPI, openId: account, accessToken: 'other-token',
      });
      await other.collection('events').doc('event').set({ test: true });
      expect(await retainCOROSTrainingCompletion(db, otherUid, 'event', account, account, null, marker, 'root'))
        .toEqual({ retained: true, linkedWorkoutIds: [] });
      expect((await other.collection('trainingWorkoutCompletions').get()).empty).toBe(true);
    });

    it.each([
      ['date', { localDate: '2026-09-18', revision: 3 }],
      ['plan', { planId: 'another-plan', revision: 3 }],
    ])('does not link a stale delivered occurrence after a %s transfer', async (_kind, change) => {
      await user().collection('scheduledWorkouts').doc('workout').update(change);
      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: [] });
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
      expect((await user().collection(DELIVERY_LEDGER).doc('delivery').get()).get('actual.completed')).toBe(false);
      await user().collection(DELIVERY_LEDGER).doc('delivery').update(_kind === 'date'
        ? { 'actual.localDate': change.localDate } : { planId: change.planId });
      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: ['workout'] });
    });

    it('does not let unrelated provider artifact IDs mask the exact COROS marker', async () => {
      const base = (await user().collection(DELIVERY_LEDGER).doc('delivery').get()).data() as DeliveryLedgerV1;
      await Promise.all(['garmin-a', 'garmin-b'].map((id, index) => user().collection(DELIVERY_LEDGER).doc(id).set({
        ...base,
        id,
        provider: 'garmin',
        workoutId: `garmin-workout-${index}`,
        destinationKey: `garmin-${index}`,
      })));
      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: ['workout'] });
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).data())
        .toMatchObject({ provider: 'coros', eventId: 'event' });
    });

    it('rejects existing manual completions and reverse links owned by another delivery', async () => {
      const completion = {
        schemaVersion: 1,
        workoutId: 'workout',
        planId: 'plan',
        provider: 'coros',
        matchMethod: 'manual_confirmation',
        eventId: 'event',
        activityId: 'activity',
        sourceSessionIndex: null,
        activityStartAtMs: Date.parse('2026-09-17T07:00:00Z'),
        scheduledLocalDate: '2026-09-17',
        workoutRevisionAtLink: 2,
        timing: 'on_date',
        linkedAtMs: 1,
        updatedAtMs: 1,
      };
      await user().collection('trainingWorkoutCompletions').doc('workout').set(completion);
      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: [] });
      expect((await user().collection('events').doc('event').collection('trainingCompletionEvidence').doc('coros').get()).data())
        .toMatchObject({ outcome: 'conflict' });
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).data())
        .toEqual(completion);

      await user().collection('trainingWorkoutCompletions').doc('workout').delete();
      const reverseId = createHash('sha256').update(JSON.stringify([uid, 'event', 'coros'])).digest('hex');
      await user().collection('trainingActivityCompletionLinks').doc(reverseId).set({
        schemaVersion: 1,
        deliveryId: 'another-delivery',
        workoutId: 'workout',
        eventId: 'event',
        activityId: 'activity',
        sourceSessionIndex: null,
        provider: 'coros',
        linkedAtMs: 1,
      });
      expect(await retain()).toEqual({ retained: true, linkedWorkoutIds: [] });
      expect((await user().collection('events').doc('event').collection('trainingCompletionEvidence').doc('coros').get()).data())
        .toMatchObject({ outcome: 'conflict' });
      expect((await user().collection('trainingActivityCompletionLinks').doc(reverseId).get()).data())
        .toMatchObject({ deliveryId: 'another-delivery' });
      const retainedLedger = (await user().collection(DELIVERY_LEDGER).doc('delivery').get()).data();
      expect(retainedLedger).toMatchObject({ status: 'delivered' });
      expect(retainedLedger).not.toHaveProperty('completionLinkId');
    });

    it('defers while delivery is changing and fences deleted events and users', async () => {
      await user().collection(DELIVERY_LEDGER).doc('delivery').update({ attempt: { id: 'operation' } });
      await expect(retain()).rejects.toThrow('delivery is changing');
      await user().collection(DELIVERY_LEDGER).doc('delivery').update({ attempt: null });
      await user().collection('events').doc('event').delete();
      expect(await retain()).toEqual({ retained: false, linkedWorkoutIds: [] });
      await user().collection('events').doc('event').set({ test: true });
      await db.collection('userDeletionTombstones').doc(uid).set({ deleting: true });
      expect(await retain()).toEqual({ retained: false, linkedWorkoutIds: [] });
    });
  },
);
