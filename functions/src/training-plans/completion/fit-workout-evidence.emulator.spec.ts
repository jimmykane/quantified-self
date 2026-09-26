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
    const activityFileID = 'source-file';
    const remoteWorkoutId = String(0xfffffffe);
    const activityStartAtMs = Date.parse('2026-09-17T07:00:00Z');
    let uid: string;
    let destinationKey: string;
    const user = () => db.collection('users').doc(uid);
    const event = () => user().collection('events').doc('event');
    const evidence = () => event().collection('trainingCompletionEvidence').doc('fit');
    const retain = (eventId = 'event', activities = [{ id: 'activity', startTimeMs: activityStartAtMs }]) =>
      retainGarminFITWorkoutReferences(db, uid, eventId, account, 'credential',
        { activityFileID, activityFileType: 'FIT' }, standardWorkoutReferenceFitFixture(),
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
        serviceUserID: account, serviceActivityFileID: activityFileID, serviceActivityFileType: 'FIT' });
      await user().collection('activities').doc('activity').set({ userID: uid, eventID: 'event', startDate: activityStartAtMs });
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

    it('checks the persisted Garmin file identity and activity before linking', async () => {
      const metadata = event().collection('metaData').doc(ServiceNames.GarminAPI);
      const storedActivity = user().collection('activities').doc('activity');
      await metadata.update({ serviceActivityFileID: 'a-different-file' });
      expect(await retain()).toBe(false);
      expect((await evidence().get()).exists).toBe(false);
      await metadata.update({ serviceActivityFileID: activityFileID });
      await storedActivity.update({ eventID: 'another-event' });
      expect(await retain()).toBe(true);
      expect((await evidence().get()).data()?.correlationState).toBe('conflict');
      await storedActivity.update({ eventID: 'event', startDate: activityStartAtMs + 60_000 });
      expect(await retain()).toBe(true);
      expect((await evidence().get()).data()?.correlationState).toBe('conflict');
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
    });

    it('refreshes a reimported activity time without creating another link', async () => {
      expect(await retain()).toBe(true);
      const previous = (await user().collection('trainingWorkoutCompletions').doc('workout').get()).data()!;
      const movedStart = activityStartAtMs + 60_000;
      await user().collection('activities').doc('activity').update({ startDate: movedStart });
      expect(await retain('event', [{ id: 'activity', startTimeMs: movedStart }])).toBe(true);
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).data()).toMatchObject({
        activityStartAtMs: movedStart, linkedAtMs: previous.linkedAtMs,
      });
      expect((await evidence().get()).data()?.correlationState).toBe('already_linked');
      expect((await user().collection('trainingActivityCompletionLinks').get()).size).toBe(1);
    });

    it('does not transfer provider-owned completion protection to a new activity link', async () => {
      await user().collection(DELIVERY_LEDGER).doc('delivery').update({ 'actual.completed': true, status: 'completed' });
      expect(await retain()).toBe(true);
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).exists).toBe(true);
      const ledger = (await user().collection(DELIVERY_LEDGER).doc('delivery').get()).data()!;
      expect(ledger.actual.completed).toBe(true);
      expect(ledger.completionLinkId).toBeFalsy();
    });

    it('accepts a FIT fallback under its original GPX source label', async () => {
      await event().collection('metaData').doc(ServiceNames.GarminAPI).update({ serviceActivityFileType: 'GPX' });
      expect(await retainGarminFITWorkoutReferences(db, uid, 'event', account, 'credential',
        { activityFileID, activityFileType: 'GPX' }, standardWorkoutReferenceFitFixture(),
        [{ id: 'activity', startTimeMs: activityStartAtMs }], Date.parse('2026-09-17T08:00:00Z'))).toBe(true);
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).exists).toBe(true);
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

    it('links exact marker evidence without claiming that a shortened recording met the prescription', async () => {
      await user().collection('activities').doc('activity').update({ durationSeconds: 30, incomplete: true });
      expect(await retain()).toBe(true);
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).data())
        .toMatchObject({ provider: 'garmin', matchMethod: 'provider_marker', activityId: 'activity' });
      expect((await user().collection('activities').doc('activity').get()).data())
        .toMatchObject({ durationSeconds: 30, incomplete: true });
    });

    it('leaves a FIT with no Garmin workout marker unlinked and preserves the first reused-marker event', async () => {
      expect(await retainGarminFITWorkoutReferences(db, uid, 'event', account, 'credential',
        { activityFileID, activityFileType: 'FIT' }, standardWorkoutReferenceFitFixture(false),
        [{ id: 'activity', startTimeMs: activityStartAtMs }])).toBe(true);
      expect((await evidence().get()).data()).toMatchObject({ correlationState: 'candidate_only' });
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
      expect(await retain()).toBe(true);
      const second = user().collection('events').doc('second-event'); await second.set({ test: true });
      await second.collection('metaData').doc(ServiceNames.GarminAPI).set({ serviceName: ServiceNames.GarminAPI,
        serviceUserID: account, serviceActivityFileID: 'second-file', serviceActivityFileType: 'FIT' });
      await user().collection('activities').doc('second-activity').set({
        userID: uid, eventID: second.id, startDate: activityStartAtMs,
      });
      expect(await retainGarminFITWorkoutReferences(db, uid, second.id, account, 'credential',
        { activityFileID: 'second-file', activityFileType: 'FIT' }, standardWorkoutReferenceFitFixture(),
        [{ id: 'second-activity', startTimeMs: activityStartAtMs }])).toBe(true);
      expect((await second.collection('trainingCompletionEvidence').doc('fit').get()).data())
        .toMatchObject({ correlationState: 'conflict' });
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).data())
        .toMatchObject({ eventId: 'event', activityId: 'activity' });
    });

    it('fences stale reconnect credentials and another owner with the same FIT marker', async () => {
      const tokenRoot = db.collection('garminAPITokens').doc(uid);
      await tokenRoot.update({ activeOAuthCredentialGeneration: 'reconnected' });
      await tokenRoot.collection('tokens').doc(account).update({ tokenCredentialGeneration: 'reconnected' });
      expect(await retain()).toBe(false);
      expect(await retainGarminFITWorkoutReferences(db, uid, 'event', account, 'reconnected',
        { activityFileID, activityFileType: 'FIT' }, standardWorkoutReferenceFitFixture(),
        [{ id: 'activity', startTimeMs: activityStartAtMs }])).toBe(true);
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).exists).toBe(true);
      const otherUid = `garmin-completion-${randomUUID()}`; uids.push(otherUid);
      const other = db.collection('users').doc(otherUid); await other.set({ test: true });
      await other.collection('meta').doc(ServiceNames.GarminAPI).set({ connectionState: 'connected',
        connectionStateGeneration: 'connection', providerUserId: account });
      await db.collection('garminAPITokens').doc(otherUid).set({ activeOAuthCredentialGeneration: 'credential' });
      await db.collection('garminAPITokens').doc(otherUid).collection('tokens').doc(account).set({
        serviceName: ServiceNames.GarminAPI, userID: account, tokenCredentialGeneration: 'credential',
        permissions: ['WORKOUT_IMPORT'],
      });
      const otherEvent = other.collection('events').doc('event'); await otherEvent.set({ test: true });
      await otherEvent.collection('metaData').doc(ServiceNames.GarminAPI).set({ serviceName: ServiceNames.GarminAPI,
        serviceUserID: account, serviceActivityFileID: activityFileID, serviceActivityFileType: 'FIT' });
      await other.collection('activities').doc('activity').set({
        userID: otherUid, eventID: 'event', startDate: activityStartAtMs,
      });
      expect(await retainGarminFITWorkoutReferences(db, otherUid, 'event', account, 'credential',
        { activityFileID, activityFileType: 'FIT' }, standardWorkoutReferenceFitFixture(),
        [{ id: 'activity', startTimeMs: activityStartAtMs }])).toBe(true);
      expect((await other.collection('trainingWorkoutCompletions').get()).empty).toBe(true);
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
      await user().collection('scheduledWorkouts').doc('other-workout').set({
        ...(await user().collection('scheduledWorkouts').doc('workout').get()).data(),
        id: 'other-workout', localDate: '2026-09-24',
      });
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

    it('ignores a retired remote Workout ID and links only the accepted replacement ID', async () => {
      const replacementWorkoutId = String(0xfffffffd);
      await user().collection(DELIVERY_LEDGER).doc('delivery').update({
        'actual.ids.workout': replacementWorkoutId,
        'actual.ids.schedule': '18',
        lastAcceptedAtMs: 2,
      });

      expect(await retain()).toBe(true);
      expect((await evidence().get()).data()).toMatchObject({ correlationState: 'candidate_only' });
      expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);

      const replacementEvent = user().collection('events').doc('replacement-event');
      await replacementEvent.set({ test: true });
      await replacementEvent.collection('metaData').doc(ServiceNames.GarminAPI).set({
        serviceName: ServiceNames.GarminAPI, serviceUserID: account,
        serviceActivityFileID: 'replacement-file', serviceActivityFileType: 'FIT',
      });
      await user().collection('activities').doc('replacement-activity').set({
        userID: uid, eventID: replacementEvent.id, startDate: activityStartAtMs,
      });
      expect(await retainGarminFITWorkoutReferences(db, uid, replacementEvent.id, account, 'credential',
        { activityFileID: 'replacement-file', activityFileType: 'FIT' },
        standardWorkoutReferenceFitFixture(true, Number(replacementWorkoutId)),
        [{ id: 'replacement-activity', startTimeMs: activityStartAtMs }])).toBe(true);
      expect((await replacementEvent.collection('trainingCompletionEvidence').doc('fit').get()).data())
        .toMatchObject({ correlationState: 'linked' });
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).data())
        .toMatchObject({ provider: 'garmin', eventId: replacementEvent.id, activityId: 'replacement-activity' });

      expect(await retain()).toBe(true);
      expect((await evidence().get()).data()).toMatchObject({ correlationState: 'candidate_only' });
      expect((await user().collection('trainingWorkoutCompletions').doc('workout').get()).data())
        .toMatchObject({ eventId: replacementEvent.id, activityId: 'replacement-activity' });
    });

    it('leaves malformed retained delivery identities as private candidates without failing import', async () => {
      await user().collection(DELIVERY_LEDGER).doc('delivery').update({ workoutId: 'invalid/path' });
      expect(await retain()).toBe(true);
      expect((await evidence().get()).data()?.correlationState).toBe('candidate_only');
      await user().collection(DELIVERY_LEDGER).doc('delivery').update({ workoutId: 'workout', 'actual.ids.schedule': 42 });
      expect(await retain()).toBe(true);
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
