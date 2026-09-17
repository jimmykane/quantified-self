import { createHash } from 'node:crypto';
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
  type EventInterface,
} from '@sports-alliance/sports-lib';
import { parseScheduledWorkoutV1 } from '../../../shared/training-plans';
import { trainingDeliveryLocalDate } from '../../../shared/training-provider-delivery';
import {
  TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID,
  TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID,
  parseTrainingWorkoutCompletionV1,
  type TrainingWorkoutCompletionTiming,
  type TrainingWorkoutCompletionV1,
} from '../../../shared/training-workout-completion';
import { SPORTS_LIB_VERSION } from '../shared/sports-lib-version.node';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { fitWorkoutEvidencePayload, readFITWorkoutReferenceEvidence } from '../training-plans/completion/fit-workout-evidence';
import type { FITWorkoutReferenceEvidence } from '../training-plans/completion/fit-workout-evidence';
import { DELIVERY_LEDGER, type DeliveryLedgerV1 } from '../training-plans/delivery/contracts';
import { readTrainingDeliveryAuthority } from '../training-plans/delivery/connection';
import { projectDelivery } from '../training-plans/delivery/store';

export { readFITWorkoutReferenceEvidence } from '../training-plans/completion/fit-workout-evidence';

const MAX_EXACT_GUIDE_IDS = 30;
const QS_SUUNTO_EXTERNAL_ID = /^qs-suunto-[A-Za-z0-9_-]{43}$/;

export interface FITActivityReference {
  id: string;
  startTimeMs: number | null;
}

export interface SuuntoGuideCompletion {
  sessionIndex: number;
  startTimeUnixMs: number | null;
  externalIds: string[];
}

export interface RetainedFITWorkoutEvidenceResult {
  retained: boolean;
  linkedWorkoutIds: string[];
}

function timestampMs(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const milliseconds = Number((value as { toMillis: () => unknown }).toMillis());
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  const milliseconds = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function fitActivityReferencesFromEvent(event: Pick<EventInterface, 'getActivities'>): FITActivityReference[] {
  return event.getActivities().flatMap(activity => {
    const id = `${activity.getID?.() ?? ''}`.trim();
    return id ? [{ id, startTimeMs: timestampMs(activity.startDate) }] : [];
  });
}

/** Compatibility projection for existing callers and tests. Provider ownership
 * is checked here; account authority is checked again before persistence. */
export function readSuuntoGuideCompletions(input: ArrayBuffer | Uint8Array, clientId: string): SuuntoGuideCompletion[] {
  if (!clientId) return [];
  const evidence = readFITWorkoutReferenceEvidence(input);
  return projectSuuntoGuideCompletions(evidence, clientId);
}

function projectSuuntoGuideCompletions(
  evidence: FITWorkoutReferenceEvidence,
  clientId: string,
): SuuntoGuideCompletion[] {
  if (evidence.status === 'invalid') return [];
  const startBySession = new Map(evidence.sessions.map(session => [session.sessionIndex, session.startTimeUnixMs ?? null]));
  const idsBySession = new Map<number, string[]>();
  for (const reference of evidence.suuntoGuides) {
    if (reference.ownerId !== clientId || !QS_SUUNTO_EXTERNAL_ID.test(reference.externalId)) continue;
    const ids = idsBySession.get(reference.sessionIndex) ?? [];
    if (!ids.includes(reference.externalId)) ids.push(reference.externalId);
    idsBySession.set(reference.sessionIndex, ids);
  }
  return [...idsBySession]
    .sort(([left], [right]) => left - right)
    .map(([sessionIndex, externalIds]) => ({ sessionIndex, startTimeUnixMs: startBySession.get(sessionIndex) ?? null, externalIds }));
}

function activityForSession(session: SuuntoGuideCompletion, activities: readonly FITActivityReference[]): FITActivityReference | null {
  if (session.startTimeUnixMs === null) return null;
  const matches = activities.filter(activity => activity.startTimeMs !== null
    && Math.abs(activity.startTimeMs - session.startTimeUnixMs!) <= 2_000);
  return matches.length === 1 ? matches[0] : null;
}

function timingFor(localDate: string, activityStartAtMs: number | null, timeZone: string): TrainingWorkoutCompletionTiming {
  if (activityStartAtMs === null) return 'unknown';
  const activityLocalDate = trainingDeliveryLocalDate(activityStartAtMs, timeZone);
  return activityLocalDate === localDate ? 'on_date' : activityLocalDate < localDate ? 'early' : 'late';
}

function activityLinkId(uid: string, eventId: string, sessionIndex: number): string {
  return createHash('sha256').update(JSON.stringify([uid, eventId, sessionIndex])).digest('hex');
}

function candidateLedger(snapshot: QueryDocumentSnapshot, destinationKey: string, externalId: string): DeliveryLedgerV1 | null {
  const data = snapshot.data() as DeliveryLedgerV1;
  if (data.schemaVersion !== 1 || data.provider !== 'suunto' || data.destinationKey !== destinationKey
    || data.actual?.ids.externalId !== externalId || data.actual.completed !== false) return null;
  // Completion must serialize with delivery writes. Retrying the import after
  // the short delivery lease is safer than allowing a late checkpoint to erase it.
  if (data.attempt || data.lease) throw new Error('Training completion link deferred while delivery is changing.');
  return data;
}

/** Retains neutral Sports Lib evidence and links only one unambiguous, account-bound
 * QS Guide marker in a source session. It never infers target adherence from FIT. */
export async function retainSuuntoGuideCompletions(
  db: Firestore,
  uid: string,
  eventId: string,
  account: string,
  tokenGeneration: string,
  input: ArrayBuffer | Uint8Array,
  clientId: string,
  activities: readonly FITActivityReference[] = [],
  nowMs = Date.now(),
): Promise<RetainedFITWorkoutEvidenceResult> {
  const evidence = readFITWorkoutReferenceEvidence(input);
  const sessions = projectSuuntoGuideCompletions(evidence, clientId);
  if (evidence.status === 'invalid' || sessions.length === 0) return { retained: false, linkedWorkoutIds: [] };
  const exactIds = [...new Set(sessions.flatMap(session => session.externalIds))];
  if (exactIds.length === 0 || exactIds.length > MAX_EXACT_GUIDE_IDS) return { retained: false, linkedWorkoutIds: [] };

  const user = db.collection('users').doc(uid);
  const eventRef = user.collection('events').doc(eventId);
  return db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) {
      return { retained: false, linkedWorkoutIds: [] };
    }
    const authority = await readTrainingDeliveryAuthority(db, tx, uid, 'suunto');
    const eventDoc = await tx.get(eventRef);
    if (!eventDoc.exists || authority.connection.state !== 'connected' || authority.account !== account
      || authority.token?.data().tokenCredentialGeneration !== tokenGeneration) {
      return { retained: false, linkedWorkoutIds: [] };
    }

    const ledgerSnapshot = await tx.get(user.collection(DELIVERY_LEDGER)
      .where('actual.ids.externalId', 'in', exactIds));
    const ledgersByExternalId = new Map<string, DeliveryLedgerV1[]>();
    for (const document of ledgerSnapshot.docs) {
      const externalId = document.data()?.actual?.ids?.externalId;
      if (typeof externalId !== 'string') continue;
      const ledger = candidateLedger(document, authority.connection.destinationKey, externalId);
      if (ledger) ledgersByExternalId.set(externalId, [...(ledgersByExternalId.get(externalId) ?? []), ledger]);
    }

    const uniqueByWorkout = new Map<string, { session: SuuntoGuideCompletion; ledger: DeliveryLedgerV1 }>();
    const conflictedWorkoutIds = new Set<string>();
    for (const session of sessions) {
      const candidates = session.externalIds.flatMap(externalId => ledgersByExternalId.get(externalId) ?? []);
      const unique = [...new Map(candidates.map(ledger => [ledger.id, ledger])).values()];
      if (unique.length !== 1) continue;
      const ledger = unique[0];
      if (uniqueByWorkout.has(ledger.workoutId)) conflictedWorkoutIds.add(ledger.workoutId);
      else uniqueByWorkout.set(ledger.workoutId, { session, ledger });
    }
    for (const workoutId of conflictedWorkoutIds) uniqueByWorkout.delete(workoutId);

    const candidates = [...uniqueByWorkout.values()];
    const related = await Promise.all(candidates.map(async candidate => {
      const reverseId = activityLinkId(uid, eventId, candidate.session.sessionIndex);
      const [workout, completion, reverse] = await Promise.all([
        tx.get(user.collection('scheduledWorkouts').doc(candidate.ledger.workoutId)),
        tx.get(user.collection(TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID).doc(candidate.ledger.workoutId)),
        tx.get(user.collection(TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID).doc(reverseId)),
      ]);
      return { ...candidate, reverseId, workout, completion, reverse };
    }));

    const linkedWorkoutIds: string[] = [];
    const matchOutcomes: Array<{ sessionIndex: number; workoutId: string; state: 'linked' | 'already_linked' | 'conflict' | 'workout_unavailable' }> = [];
    for (const candidate of related) {
      const { ledger, session } = candidate;
      if (!candidate.workout.exists) {
        matchOutcomes.push({ sessionIndex: session.sessionIndex, workoutId: ledger.workoutId, state: 'workout_unavailable' });
        continue;
      }
      const workout = parseScheduledWorkoutV1(candidate.workout.data());
      if (workout.lifecycle === 'deleted') {
        matchOutcomes.push({ sessionIndex: session.sessionIndex, workoutId: ledger.workoutId, state: 'workout_unavailable' });
        continue;
      }
      let existingCompletion: TrainingWorkoutCompletionV1 | undefined;
      try {
        existingCompletion = candidate.completion.exists
          ? parseTrainingWorkoutCompletionV1(candidate.completion.data())
          : undefined;
      } catch {
        matchOutcomes.push({ sessionIndex: session.sessionIndex, workoutId: ledger.workoutId, state: 'conflict' });
        continue;
      }
      const existingReverse = candidate.reverse.data() as { workoutId?: unknown; eventId?: unknown; sourceSessionIndex?: unknown } | undefined;
      const sameCompletion = existingCompletion?.eventId === eventId
        && existingCompletion.sourceSessionIndex === session.sessionIndex;
      const sameReverse = existingReverse?.workoutId === workout.id && existingReverse.eventId === eventId
        && existingReverse.sourceSessionIndex === session.sessionIndex;
      if ((candidate.completion.exists && !sameCompletion) || (candidate.reverse.exists && !sameReverse)) {
        matchOutcomes.push({ sessionIndex: session.sessionIndex, workoutId: ledger.workoutId, state: 'conflict' });
        continue;
      }

      const activity = activityForSession(session, activities);
      const completion: TrainingWorkoutCompletionV1 = existingCompletion ?? {
        schemaVersion: 1,
        workoutId: workout.id,
        planId: workout.planId,
        provider: 'suunto',
        matchMethod: 'provider_marker',
        eventId,
        activityId: activity?.id ?? null,
        sourceSessionIndex: session.sessionIndex,
        activityStartAtMs: activity?.startTimeMs ?? session.startTimeUnixMs,
        scheduledLocalDate: workout.localDate,
        workoutRevisionAtLink: workout.revision,
        timing: timingFor(workout.localDate, activity?.startTimeMs ?? session.startTimeUnixMs, ledger.timeZone),
        linkedAtMs: nowMs,
        updatedAtMs: nowMs,
      };
      tx.set(user.collection(TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID).doc(workout.id), completion);
      tx.set(user.collection(TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID).doc(candidate.reverseId), {
        schemaVersion: 1,
        deliveryId: ledger.id,
        workoutId: workout.id,
        eventId,
        activityId: completion.activityId,
        sourceSessionIndex: session.sessionIndex,
        provider: 'suunto',
        linkedAtMs: completion.linkedAtMs,
      });
      const completedLedger: DeliveryLedgerV1 = {
        ...ledger,
        completionLinkId: candidate.reverseId,
        desired: 'preserve',
        status: 'completed',
        actual: { ...ledger.actual!, completed: true },
        updatedAtMs: nowMs,
      };
      tx.set(user.collection(DELIVERY_LEDGER).doc(ledger.id), completedLedger);
      tx.set(user.collection('trainingDeliveryStatuses').doc(ledger.id), projectDelivery(completedLedger));
      linkedWorkoutIds.push(workout.id);
      matchOutcomes.push({ sessionIndex: session.sessionIndex, workoutId: ledger.workoutId,
        state: existingCompletion ? 'already_linked' : 'linked' });
    }

    const filteredGuides = evidence.suuntoGuides.filter(reference => reference.ownerId === clientId
      && QS_SUUNTO_EXTERNAL_ID.test(reference.externalId));
    tx.set(eventRef.collection('trainingCompletionEvidence').doc('fit'), {
      schemaVersion: 1,
      reader: 'sports-lib',
      sportsLibVersion: SPORTS_LIB_VERSION,
      sourceProvider: 'suunto',
      accountDigest: createHash('sha256').update(account).digest('hex'),
      ...fitWorkoutEvidencePayload(evidence, filteredGuides),
      matchOutcomes,
      capturedAtMs: nowMs,
    });
    // Remove the pre-Sports-Lib evidence leaf only after its replacement is durable.
    tx.delete(eventRef.collection('trainingCompletionEvidence').doc('suunto'));
    return { retained: true, linkedWorkoutIds };
  });
}
