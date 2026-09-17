import { createHash } from 'node:crypto';
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { parseScheduledWorkoutV1 } from '../../../shared/training-plans';
import { trainingDeliveryLocalDate } from '../../../shared/training-provider-delivery';
import {
  TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID,
  TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID,
  parseTrainingWorkoutCompletionV1,
  type TrainingWorkoutCompletionTiming,
  type TrainingWorkoutCompletionV1,
} from '../../../shared/training-workout-completion';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { DELIVERY_LEDGER, type DeliveryLedgerV1 } from '../training-plans/delivery/contracts';
import { readTrainingDeliveryAuthority } from '../training-plans/delivery/connection';
import { projectDelivery } from '../training-plans/delivery/store';
import type { FITActivityReference } from '../suunto/guide-completion';
import { normalizeCOROSOpenId } from './account';

const COROS_POSITIVE_INT32 = /^[1-9]\d{0,9}$/;

export interface RetainedCOROSTrainingCompletionResult {
  retained: boolean;
  linkedWorkoutIds: string[];
}

function exactPlanWorkoutId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!COROS_POSITIVE_INT32.test(normalized)) return null;
  const integer = Number(normalized);
  return Number.isSafeInteger(integer) && integer <= 2_147_483_647 ? normalized : null;
}

function tokenGeneration(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function candidateLedger(
  snapshot: QueryDocumentSnapshot,
  destinationKey: string,
  planWorkoutId: string,
): DeliveryLedgerV1 | null {
  const ledger = snapshot.data() as DeliveryLedgerV1;
  if (ledger.schemaVersion !== 1 || ledger.provider !== 'coros' || ledger.destinationKey !== destinationKey
    || ledger.actual?.ids.workout !== planWorkoutId) return null;
  // Completion and provider writes serialize on the same delivery identity. A
  // queue retry is safer than allowing a late batch checkpoint to erase this link.
  if (ledger.attempt || ledger.lease) throw new Error('Training completion link deferred while delivery is changing.');
  return ledger;
}

function completionTiming(localDate: string, activityStartAtMs: number | null, timeZone: string): TrainingWorkoutCompletionTiming {
  if (activityStartAtMs === null) return 'unknown';
  const activityLocalDate = trainingDeliveryLocalDate(activityStartAtMs, timeZone);
  return activityLocalDate === localDate ? 'on_date' : activityLocalDate < localDate ? 'early' : 'late';
}

function reverseLinkId(uid: string, eventId: string): string {
  return createHash('sha256').update(JSON.stringify([uid, eventId, 'coros'])).digest('hex');
}

/** Links COROS's exact inbound planWorkoutId to the stable ID supplied by QS.
 * It does not infer completion from dates, sports, names or target adherence. */
export async function retainCOROSTrainingCompletion(
  db: Firestore,
  uid: string,
  eventId: string,
  accountValue: string,
  tokenDocumentId: string,
  tokenCredentialGeneration: string | null,
  planWorkoutIdValue: unknown,
  componentKey: string | undefined,
  activities: readonly FITActivityReference[] = [],
  nowMs = Date.now(),
): Promise<RetainedCOROSTrainingCompletionResult> {
  const account = normalizeCOROSOpenId(accountValue);
  const planWorkoutId = exactPlanWorkoutId(planWorkoutIdValue);
  // New COROS queue rows always identify a non-multisport workout as `root`.
  // Component rows can repeat the marker and therefore cannot establish a
  // unique completion on their own.
  if (!account || !planWorkoutId || componentKey !== 'root') {
    return { retained: false, linkedWorkoutIds: [] };
  }

  const user = db.collection('users').doc(uid);
  const eventRef = user.collection('events').doc(eventId);
  return db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) {
      return { retained: false, linkedWorkoutIds: [] };
    }
    const authority = await readTrainingDeliveryAuthority(db, tx, uid, 'coros');
    const event = await tx.get(eventRef);
    const authorityTokenGeneration = tokenGeneration(authority.token?.data().tokenCredentialGeneration);
    if (!event.exists || authority.connection.state !== 'connected' || authority.account !== account
      || authority.token?.id !== tokenDocumentId
      || authorityTokenGeneration !== tokenGeneration(tokenCredentialGeneration)) {
      return { retained: false, linkedWorkoutIds: [] };
    }

    const ledgerQuery = await tx.get(user.collection(DELIVERY_LEDGER)
      .where('actual.ids.workout', '==', planWorkoutId).limit(2));
    const candidates = ledgerQuery.docs.flatMap(document => {
      const candidate = candidateLedger(document, authority.connection.destinationKey, planWorkoutId);
      return candidate ? [candidate] : [];
    });
    const candidate = candidates.length === 1 ? candidates[0] : null;
    const reverseId = reverseLinkId(uid, eventId);
    const related = candidate ? await Promise.all([
      tx.get(user.collection('scheduledWorkouts').doc(candidate.workoutId)),
      tx.get(user.collection(TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID).doc(candidate.workoutId)),
      tx.get(user.collection(TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID).doc(reverseId)),
    ]) : null;

    let outcome: 'linked' | 'already_linked' | 'missing' | 'conflict' | 'workout_unavailable' = candidates.length > 1
      ? 'conflict' : 'missing';
    const linkedWorkoutIds: string[] = [];
    if (candidate && related) {
      const [workoutDocument, completionDocument, reverseDocument] = related;
      if (!workoutDocument.exists) outcome = 'workout_unavailable';
      else {
        const workout = parseScheduledWorkoutV1(workoutDocument.data());
        if (workout.lifecycle === 'deleted') outcome = 'workout_unavailable';
        else {
          let existingCompletion: TrainingWorkoutCompletionV1 | null = null;
          try {
            existingCompletion = completionDocument.exists
              ? parseTrainingWorkoutCompletionV1(completionDocument.data()) : null;
          } catch {
            outcome = 'conflict';
          }
          const reverse = reverseDocument.data() as {
            workoutId?: unknown;
            eventId?: unknown;
            sourceSessionIndex?: unknown;
            provider?: unknown;
          } | undefined;
          const sameCompletion = existingCompletion?.eventId === eventId
            && existingCompletion.provider === 'coros'
            && existingCompletion.sourceSessionIndex === null;
          const sameReverse = reverse?.workoutId === workout.id && reverse.eventId === eventId
            && reverse.sourceSessionIndex === null && reverse.provider === 'coros';
          if (outcome !== 'conflict' && ((completionDocument.exists && !sameCompletion)
            || (reverseDocument.exists && !sameReverse))) outcome = 'conflict';
          if (outcome !== 'conflict') {
            const activity = activities.length === 1 ? activities[0] : null;
            const completion: TrainingWorkoutCompletionV1 = existingCompletion ?? {
              schemaVersion: 1,
              workoutId: workout.id,
              planId: workout.planId,
              provider: 'coros',
              matchMethod: 'provider_marker',
              eventId,
              activityId: activity?.id ?? null,
              sourceSessionIndex: null,
              activityStartAtMs: activity?.startTimeMs ?? null,
              scheduledLocalDate: workout.localDate,
              workoutRevisionAtLink: workout.revision,
              timing: completionTiming(workout.localDate, activity?.startTimeMs ?? null, candidate.timeZone),
              linkedAtMs: nowMs,
              updatedAtMs: nowMs,
            };
            tx.set(user.collection(TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID).doc(workout.id), completion);
            tx.set(user.collection(TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID).doc(reverseId), {
              schemaVersion: 1,
              deliveryId: candidate.id,
              workoutId: workout.id,
              eventId,
              activityId: completion.activityId,
              sourceSessionIndex: null,
              provider: 'coros',
              linkedAtMs: completion.linkedAtMs,
            });
            const completedLedger: DeliveryLedgerV1 = {
              ...candidate,
              completionLinkId: reverseId,
              desired: 'preserve',
              status: 'completed',
              actual: { ...candidate.actual!, completed: true },
              updatedAtMs: nowMs,
            };
            tx.set(user.collection(DELIVERY_LEDGER).doc(candidate.id), completedLedger);
            tx.set(user.collection('trainingDeliveryStatuses').doc(candidate.id), projectDelivery(completedLedger));
            linkedWorkoutIds.push(workout.id);
            outcome = existingCompletion ? 'already_linked' : 'linked';
          }
        }
      }
    }

    tx.set(eventRef.collection('trainingCompletionEvidence').doc('coros'), {
      schemaVersion: 1,
      sourceProvider: 'coros',
      accountDigest: createHash('sha256').update(account).digest('hex'),
      planWorkoutId,
      componentKey,
      outcome,
      capturedAtMs: nowMs,
    });
    return { retained: true, linkedWorkoutIds };
  });
}
