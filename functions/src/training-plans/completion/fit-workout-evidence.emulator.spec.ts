import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { ActivityTypes, ServiceNames } from '@sports-alliance/sports-lib';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { deliveryIdentity } from '../delivery/intent';
import { DELIVERY_LEDGER, type DeliveryLedgerV1 } from '../delivery/contracts';
import { standardWorkoutReferenceFitFixture } from '../delivery/test-support/suunto-fit-fixture';
import { retainGarminFITWorkoutReferences } from './fit-workout-evidence';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'Garmin FIT Training completion correlation with real Firestore', { timeout: 30_000 }, () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback required');
    const db = new Firestore({ projectId: 'demo-training-garmin-completion' });
    const uids: string[] = [];
    const account = 'garmin-account';
    const remoteWorkoutId = String(0xfffffffe);
    const activityStartAtMs = Date.parse('2026-09-17T07:00:00Z');
    let uid: string;
    let destinationKey: string;
    const user = () => db.collection('users').doc(uid);
    const event = () => user().collection('events').doc('event');
    const evidence = () => event().collection('trainingCompletionEvidence').doc('fit');
    const retain = (eventId = 'event', activities = [{ id: 'activity', startTimeMs: activityStartAtMs }]) =>
      retainGarminFITWorkoutReferences(db, uid, eventId, account, 'credential', standardWorkoutReferenceFitFixture(),
        activities, Date.parse('2026-09-17T08:00:00Z'));

    async function seedLedger(id = 'delivery', workoutId = 'workout'): Promise<void> {
      const ledger: DeliveryLedgerV1 = {
        schemaVersion: 1, id, workoutId, planId: null, provider: 'garmin', destinationKey,
        desiredGeneration: 1, connectionEpoch: 0, settingsRevision: 1, desiredDigest: 'desired',
        desired: 'present', status: 'delivered', timeZone: 'Europe/Helsinki', issues: [], approvalDigest: null,
        actual: { ids: { workout: remoteWorkoutId, schedule: '17', owner: '23' }, localDate: '2026-09-17', completed: false },
        acceptedDigest: 'desired', contentDigest: 'content', acceptedContentDigest: 'content',
        attempt: null, lease: null, retries: 0, retryAtMs: 0, blockedConnectionGeneration: null,
        lastAttemptAtMs: 1, lastAcceptedAtMs: 1, updatedAtMs: 1,
      };
      await user().collection(DELIVERY_LEDGER).doc(id).set(ledger);
    }

    beforeEach(async () => {
      uid = `garmin-completion-${randomUUID()}`;
      uids.push(uid);
      destinationKey = deliveryIdentity(uid, 'garmin', account, 'account');
      await user().set({ test: true });
      await user().collection('meta').doc(ServiceNames.GarminAPI).set({ connectionState: 'connected',
        connectionStateGeneration: 'connection', providerUserId: account });
      const tokenRoot = db.collection('garminAPITokens').doc(uid);
      await tokenRoot.set({ activeOAuthCredentialGeneration: 'credential' });
      await tokenRoot.collection('tokens').doc(account).set({ serviceName: ServiceNames.GarminAPI,
        userID: account, tokenCredentialGeneration: 'credential', permissions: ['WORKOUT_IMPORT'] });
      await event().set({ test: true });
      await event().collection('metaData').doc(ServiceNames.GarminAPI).set({ serviceName: ServiceNames.GarminAPI,
        serviceUserID: account, serviceActivityFileType: 'FIT' });
      await user().collection('scheduledWorkouts').doc('workout').set({ schemaVersion: 1, id: 'workout', planId: null,
        title: 'Intervals', localDate: '2026-09-17', revision: 2, lifecycle: 'planned', createdAtMs: 1, updatedAtMs: 2,
        structure: { version: 1, sport: ActivityTypes.Cycling,
          nodes: [{ kind: 'step', id: 'step', purpose: 'work', ending: { kind: 'time', seconds: 300 }, targets: [] }] } });
      await seedLedger();
    });

    afterAll(async () => {
      for (const id of uids) {
        await db.recursiveDelete(db.collection('users').doc(id));
        await db.recursiveDelete(db.collection('garminAPITokens').doc(id));
        await db.recursiveDelete(db.collection('userDeletionTombstones').doc(id));
      }
      await db.terminate();
    });

    it('links the one account-bound scheduled occurrence and is idempotent on reimport', async () => {
      expect(await retain()).toBe(true);
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).data()).toMatchObject({
        workoutId: 'workout', provider: 'garmin', eventId: 'event', activityId: 'activity',
        matchMethod: 'provider_marker', scheduledLocalDate: '2026-09-17', timing: 'on_date',
      });
      expect((await user().collection(DELIVERY_LEDGER).doc('delivery').get()).data()).toMatchObject({
        status: 'completed', desired: 'preserve', actual: { completed: true }, completionLinkId: expect.any(String),
      });
      expect((await user().collection('trainingActivityCompletionLinks').get()).size).toBe(1);
      expect((await evidence().get()).data()).toMatchObject({ correlationState: 'linked' });
      expect(await retain()).toBe(true);
      expect((await evidence().get()).data()).toMatchObject({ correlationState: 'already_linked' });
      expect((await user().collection('trainingActivityCompletionLinks').get()).size).toBe(1);
    });

    it('retains candidate evidence but does not guess without one source activity', async () => {
      expect(await retain('event', [])).toBe(true);
      expect((await evidence().get()).data()).toMatchObject({ correlationState: 'candidate_only' });
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
      expect(await retain('event', [
        { id: 'one', startTimeMs: activityStartAtMs }, { id: 'two', startTimeMs: activityStartAtMs },
      ])).toBe(true);
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
    });

    it('requires a fully accepted schedule and the recorded date of that occurrence', async () => {
      await user().collection(DELIVERY_LEDGER).doc('delivery').update({ acceptedDigest: null });
      expect(await retain()).toBe(true);
      expect((await evidence().get()).data()).toMatchObject({ correlationState: 'candidate_only' });
      await user().collection(DELIVERY_LEDGER).doc('delivery').update({ acceptedDigest: 'desired' });
      expect(await retain('event', [{ id: 'activity', startTimeMs: Date.parse('2026-09-18T07:00:00Z') }])).toBe(true);
      expect((await evidence().get()).data()).toMatchObject({ correlationState: 'conflict' });
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
    });

    it('rejects duplicate remote IDs and a rescheduled current workout', async () => {
      await seedLedger('duplicate', 'other-workout');
      expect(await retain()).toBe(true);
      expect((await evidence().get()).data()).toMatchObject({ correlationState: 'conflict' });
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
      await user().collection(DELIVERY_LEDGER).doc('duplicate').delete();
      await user().collection('scheduledWorkouts').doc('workout').update({ localDate: '2026-09-18', revision: 3 });
      expect(await retain()).toBe(true);
      expect((await evidence().get()).data()).toMatchObject({ correlationState: 'conflict' });
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
    });

    it('does not overwrite another provider completion for the same workout', async () => {
      await user().collection('trainingWorkoutCompletions').doc('workout').set({ schemaVersion: 1,
        workoutId: 'workout', planId: null, provider: 'suunto', matchMethod: 'provider_marker', eventId: 'other',
        activityId: 'other-activity', sourceSessionIndex: 0, activityStartAtMs, scheduledLocalDate: '2026-09-17',
        workoutRevisionAtLink: 2, timing: 'on_date', linkedAtMs: 1, updatedAtMs: 1 });
      expect(await retain()).toBe(true);
      expect((await evidence().get()).data()).toMatchObject({ correlationState: 'conflict' });
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).data()).toMatchObject({ provider: 'suunto' });
      expect((await user().collection(DELIVERY_LEDGER).doc('delivery').get()).data()).toMatchObject({ status: 'delivered' });
    });

    it('rejects a changed source account and a changed current destination', async () => {
      await event().collection('metaData').doc(ServiceNames.GarminAPI).update({ serviceUserID: 'other-account' });
      expect(await retain()).toBe(false);
      expect((await evidence().get()).exists).toBe(false);
      await event().collection('metaData').doc(ServiceNames.GarminAPI).update({ serviceUserID: account });
      await user().collection(DELIVERY_LEDGER).doc('delivery').update({ destinationKey: 'different-account' });
      expect(await retain()).toBe(true);
      expect((await evidence().get()).data()).toMatchObject({ correlationState: 'candidate_only' });
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
    });

    it('does not recreate completion or evidence after account deletion starts', async () => {
      await db.collection('userDeletionTombstones').doc(uid).set({ expireAt: new Date(Date.now() + 60_000) });
      expect(await retain()).toBe(false);
      expect((await evidence().get()).exists).toBe(false);
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
    });
  });
