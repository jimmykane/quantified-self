import { createHash } from 'node:crypto';
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
  DataFITTrainingFileReferences,
  DataFITWorkoutDefinitions,
  DataSuuntoPlusGuideReferences,
  ServiceNames,
  readFITWorkoutReferences,
  type FITTrainingFileReference,
  type FITWorkoutDefinition,
  type FITWorkoutReferenceDiagnostic,
  type FITWorkoutReferenceSession,
  type SuuntoPlusGuideReference,
} from '@sports-alliance/sports-lib';
import { parseScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { trainingDeliveryLocalDate } from '../../../../shared/training-provider-delivery';
import {
  TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID,
  TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID,
  parseTrainingWorkoutCompletionV1,
  type TrainingWorkoutCompletionV1,
} from '../../../../shared/training-workout-completion';
import { SPORTS_LIB_VERSION } from '../../shared/sports-lib-version.node';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import type { FITActivityReference } from '../../suunto/guide-completion';
import { readTrainingDeliveryAuthority } from '../delivery/connection';
import { DELIVERY_LEDGER, type DeliveryLedgerV1 } from '../delivery/contracts';
import { projectDelivery } from '../delivery/store';

const MAX_PERSISTED_REFERENCES = 100;

export type QSFITWorkoutReferenceDiagnostic = FITWorkoutReferenceDiagnostic | 'qs_storage_limit';

export interface FITWorkoutReferenceEvidence {
  status: 'ok' | 'partial' | 'invalid';
  diagnostics: QSFITWorkoutReferenceDiagnostic[];
  trainingFiles: FITTrainingFileReference[];
  workouts: FITWorkoutDefinition[];
  suuntoGuides: SuuntoPlusGuideReference[];
  sessions: FITWorkoutReferenceSession[];
}

export interface PersistedFITWorkoutReferenceEvidence {
  status: FITWorkoutReferenceEvidence['status'];
  diagnostics: QSFITWorkoutReferenceDiagnostic[];
  trainingFiles: ReturnType<DataFITTrainingFileReferences['toJSON']>;
  workouts: ReturnType<DataFITWorkoutDefinitions['toJSON']>;
  suuntoGuides: ReturnType<DataSuuntoPlusGuideReferences['toJSON']>;
  sessions: FITWorkoutReferenceSession[];
}

function ownedCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Sports Lib owns FIT framing, CRC, base-type, definition and developer-field
 * parsing. This QS projection adds only a bounded Firestore persistence limit. */
export function readFITWorkoutReferenceEvidence(input: ArrayBuffer | Uint8Array): FITWorkoutReferenceEvidence {
  try {
    const result = readFITWorkoutReferences(input);
    const trainingFiles = DataFITTrainingFileReferences.fromJSON(result.trainingFiles.toJSON()).getValue().references;
    const workouts = DataFITWorkoutDefinitions.fromJSON(result.workouts.toJSON()).getValue().definitions;
    const suuntoGuides = DataSuuntoPlusGuideReferences.fromJSON(result.suuntoGuides.toJSON()).getValue().references;
    const overLimit = [trainingFiles.length, workouts.length, suuntoGuides.length, result.sessions.length]
      .some(length => length > MAX_PERSISTED_REFERENCES);
    return {
      status: overLimit && result.status !== 'invalid' ? 'partial' : result.status,
      diagnostics: [...result.diagnostics, ...(overLimit ? ['qs_storage_limit' as const] : [])],
      trainingFiles: overLimit ? [] : ownedCopy(trainingFiles),
      workouts: overLimit ? [] : ownedCopy(workouts),
      suuntoGuides: overLimit ? [] : ownedCopy(suuntoGuides),
      sessions: overLimit ? [] : ownedCopy(result.sessions),
    };
  } catch {
    return { status: 'invalid', diagnostics: ['invalid_input'], trainingFiles: [], workouts: [], suuntoGuides: [], sessions: [] };
  }
}

export function fitWorkoutEvidencePayload(
  evidence: FITWorkoutReferenceEvidence,
  suuntoGuides = evidence.suuntoGuides,
): PersistedFITWorkoutReferenceEvidence {
  return {
    status: evidence.status,
    diagnostics: evidence.diagnostics,
    trainingFiles: new DataFITTrainingFileReferences({ references: evidence.trainingFiles }).toJSON(),
    workouts: new DataFITWorkoutDefinitions({ definitions: evidence.workouts }).toJSON(),
    suuntoGuides: new DataSuuntoPlusGuideReferences({ references: suuntoGuides }).toJSON(),
    sessions: evidence.sessions,
  };
}

function garminWorkoutReference(evidence: FITWorkoutReferenceEvidence, activities: readonly FITActivityReference[]): string | null {
  if (evidence.status !== 'ok' || evidence.trainingFiles.length !== 1 || evidence.workouts.length !== 1
    || activities.length !== 1 || !activities[0].id || activities[0].startTimeMs === null) return null;
  const reference = evidence.trainingFiles[0];
  // FIT defines this as a workout-file identity, not a Training API identity.
  // Only the observed numeric overlap is considered, and every account,
  // delivery, occurrence and source-activity guard below must also agree.
  return reference.type === 5 && Number.isInteger(reference.serialNumber) && reference.serialNumber! > 0
    ? String(reference.serialNumber) : null;
}

function garminLedger(snapshot: QueryDocumentSnapshot, destinationKey: string, workoutId: string): DeliveryLedgerV1 | null {
  const ledger = snapshot.data() as DeliveryLedgerV1;
  if (ledger.schemaVersion !== 1 || ledger.id !== snapshot.id || ledger.provider !== 'garmin'
    || ledger.destinationKey !== destinationKey || !ledger.actual
    || ledger.actual.ids.workout !== workoutId || !ledger.actual.ids.schedule
    || !ledger.actual.ids.owner || !Number.isSafeInteger(ledger.lastAcceptedAtMs)
    || ledger.lastAcceptedAtMs! < 0 || typeof ledger.acceptedDigest !== 'string' || !ledger.acceptedDigest) return null;
  if (ledger.attempt || ledger.lease) throw new Error('Training completion link deferred while delivery is changing.');
  return ledger;
}

function reverseLinkId(uid: string, eventId: string): string {
  return createHash('sha256').update(JSON.stringify([uid, eventId, 'garmin'])).digest('hex');
}

/** Retain source FIT evidence, then link only a single observed workout-file
 * identity that resolves to one account-bound, dated QS Training delivery.
 * This does not infer target adherence or fall back to title/time similarity. */
export async function retainGarminFITWorkoutReferences(
  db: Firestore,
  uid: string,
  eventId: string,
  account: string,
  tokenGeneration: string,
  input: ArrayBuffer | Uint8Array,
  activities: readonly FITActivityReference[] = [],
  nowMs = Date.now(),
): Promise<boolean> {
  const evidence = readFITWorkoutReferenceEvidence(input);
  if (evidence.status === 'invalid' || (!evidence.trainingFiles.length && !evidence.workouts.length)) return false;
  const user = db.collection('users').doc(uid);
  const eventRef = user.collection('events').doc(eventId);
  return db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return false;
    const authority = await readTrainingDeliveryAuthority(db, tx, uid, 'garmin');
    const [eventDoc, eventMeta] = await Promise.all([
      tx.get(eventRef), tx.get(eventRef.collection('metaData').doc(ServiceNames.GarminAPI)),
    ]);
    if (!eventDoc.exists || authority.connection.state !== 'connected' || authority.account !== account
      || authority.token?.data().tokenCredentialGeneration !== tokenGeneration
      || eventMeta.data()?.serviceName !== ServiceNames.GarminAPI || eventMeta.data()?.serviceUserID !== account
      || eventMeta.data()?.serviceActivityFileType !== 'FIT') return false;

    const workoutId = garminWorkoutReference(evidence, activities);
    const matching = workoutId ? await tx.get(user.collection(DELIVERY_LEDGER)
      .where('actual.ids.workout', '==', workoutId).limit(2)) : null;
    const ledger = matching?.size === 1 ? garminLedger(matching.docs[0], authority.connection.destinationKey, workoutId!) : null;
    const activity = activities.length === 1 ? activities[0] : null;
    const related = ledger ? await Promise.all([
      tx.get(user.collection('scheduledWorkouts').doc(ledger.workoutId)),
      tx.get(user.collection(TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID).doc(ledger.workoutId)),
      tx.get(user.collection(TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID).doc(reverseLinkId(uid, eventId))),
    ]) : null;
    let correlationState: 'candidate_only' | 'linked' | 'already_linked' | 'conflict' = 'candidate_only';
    if (matching && matching.size > 1) correlationState = 'conflict';
    if (ledger && related && activity && activity.startTimeMs !== null) {
      const [workoutDoc, completionDoc, reverseDoc] = related;
      let workout: ReturnType<typeof parseScheduledWorkoutV1> | null = null;
      let completion: TrainingWorkoutCompletionV1 | null = null;
      try {
        workout = workoutDoc.exists ? parseScheduledWorkoutV1(workoutDoc.data()) : null;
        completion = completionDoc.exists ? parseTrainingWorkoutCompletionV1(completionDoc.data()) : null;
      } catch {
        correlationState = 'conflict';
      }
      if (correlationState !== 'conflict') {
        const reverse = reverseDoc.data() as { schemaVersion?: unknown; deliveryId?: unknown; workoutId?: unknown;
          eventId?: unknown; activityId?: unknown; sourceSessionIndex?: unknown; provider?: unknown } | undefined;
        const reverseId = reverseLinkId(uid, eventId);
        const sameCompletion = completion?.workoutId === workout?.id && completion?.eventId === eventId
          && completion?.activityId === activity.id && completion?.provider === 'garmin'
          && completion?.matchMethod === 'provider_marker' && completion.sourceSessionIndex === null
          && completion.planId === workout?.planId && completion.scheduledLocalDate === workout?.localDate;
        const sameReverse = reverse?.schemaVersion === 1 && reverse.deliveryId === ledger.id
          && reverse.workoutId === workout?.id && reverse.eventId === eventId && reverse.activityId === activity.id
          && reverse.provider === 'garmin' && reverse.sourceSessionIndex === null;
        let activityLocalDate: string | null = null;
        try { activityLocalDate = trainingDeliveryLocalDate(activity.startTimeMs, ledger.timeZone); }
        catch { /* Invalid retained zone is conflicting evidence, not a retryable import failure. */ }
        if (workout && workout.id === ledger.workoutId && workout.planId === ledger.planId
          && workout.lifecycle !== 'deleted' && workout.localDate === ledger.actual!.localDate
          && activityLocalDate === workout.localDate
          && (!completionDoc.exists || sameCompletion) && (!reverseDoc.exists || sameReverse)
          && (!ledger.actual!.completed || ledger.completionLinkId === reverseId)) {
          const linked: TrainingWorkoutCompletionV1 = completion ?? {
            schemaVersion: 1, workoutId: workout.id, planId: workout.planId, provider: 'garmin',
            matchMethod: 'provider_marker', eventId, activityId: activity.id, sourceSessionIndex: null,
            activityStartAtMs: activity.startTimeMs, scheduledLocalDate: workout.localDate,
            workoutRevisionAtLink: workout.revision, timing: 'on_date', linkedAtMs: nowMs, updatedAtMs: nowMs,
          };
          tx.set(user.collection(TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID).doc(workout.id), linked);
          tx.set(user.collection(TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID).doc(reverseId), {
            schemaVersion: 1, deliveryId: ledger.id, workoutId: workout.id, eventId,
            activityId: activity.id, sourceSessionIndex: null, provider: 'garmin', linkedAtMs: linked.linkedAtMs,
          });
          const completedLedger: DeliveryLedgerV1 = {
            ...ledger, completionLinkId: reverseId, desired: 'preserve', status: 'completed',
            actual: { ...ledger.actual!, completed: true }, updatedAtMs: nowMs,
          };
          tx.set(user.collection(DELIVERY_LEDGER).doc(ledger.id), completedLedger);
          tx.set(user.collection('trainingDeliveryStatuses').doc(ledger.id), projectDelivery(completedLedger));
          correlationState = completion ? 'already_linked' : 'linked';
        } else correlationState = 'conflict';
      }
    }
    tx.set(eventRef.collection('trainingCompletionEvidence').doc('fit'), {
      schemaVersion: 1,
      reader: 'sports-lib',
      sportsLibVersion: SPORTS_LIB_VERSION,
      sourceProvider: 'garmin',
      accountDigest: createHash('sha256').update(account).digest('hex'),
      correlationState,
      ...fitWorkoutEvidencePayload(evidence, []),
      capturedAtMs: nowMs,
    });
    return true;
  });
}
