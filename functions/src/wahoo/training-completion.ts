import { createHash } from 'node:crypto';
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
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
import type { WahooActiveAccountGuard } from './account';

const WAHOO_ID = /^[1-9]\d{0,18}$/;
const QS_WAHOO_WORKOUT_TOKEN = /^qs-workout-[A-Za-z0-9_-]{43}$/;

interface WahooTrainingCompletionCandidate {
  ledger: DeliveryLedgerV1;
  artifact: NonNullable<DeliveryLedgerV1['actual']>;
}

export interface RetainedWahooTrainingCompletionResult {
  retained: boolean;
  linkedWorkoutIds: string[];
}

function exactWahooId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return WAHOO_ID.test(normalized) ? normalized : null;
}

function exactWorkoutToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return QS_WAHOO_WORKOUT_TOKEN.test(normalized) ? normalized : null;
}

function candidateLedger(
  snapshot: QueryDocumentSnapshot,
  destinationKey: string,
  workoutId: string,
  planId: string,
  workoutToken: string,
): WahooTrainingCompletionCandidate | null {
  const ledger = snapshot.data() as DeliveryLedgerV1;
  const artifact = ledger.actual;
  if (ledger.schemaVersion !== 1 || ledger.id !== snapshot.id || ledger.provider !== 'wahoo'
    || ledger.destinationKey !== destinationKey || typeof ledger.workoutId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(ledger.workoutId)
    || !artifact || !artifact.ids || artifact.ids.workout !== workoutId || artifact.ids.plan !== planId
    || artifact.ids.workoutToken !== workoutToken || artifact.ids.association !== `${workoutId}:${planId}`) {
    return null;
  }
  // Completion and delivery writes serialize on the same delivery identity.
  // Retrying the import is safer than allowing a late checkpoint to erase the link.
  if (ledger.attempt || ledger.lease) {
    throw new Error('Training completion link deferred while delivery is changing.');
  }
  return { ledger, artifact };
}

function completionTiming(
  localDate: string,
  activityStartAtMs: number | null,
  timeZone: string,
): TrainingWorkoutCompletionTiming {
  if (activityStartAtMs === null) return 'unknown';
  const activityLocalDate = trainingDeliveryLocalDate(activityStartAtMs, timeZone);
  return activityLocalDate === localDate ? 'on_date' : activityLocalDate < localDate ? 'early' : 'late';
}

function reverseLinkId(uid: string, eventId: string): string {
  return createHash('sha256').update(JSON.stringify([uid, eventId, 'wahoo'])).digest('hex');
}

function generation(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Links an imported Wahoo activity only when its exact Workout, Plan and
 * app-supplied workout_token identify one current QS delivery. It never uses
 * date, title, sport, duration or target-adherence inference. */
export async function retainWahooTrainingCompletion(
  db: Firestore,
  uid: string,
  eventId: string,
  accountGuard: WahooActiveAccountGuard,
  workoutIdValue: unknown,
  planIdValue: unknown,
  workoutTokenValue: unknown,
  workoutSummaryIdValue: unknown,
  activities: readonly FITActivityReference[] = [],
  nowMs = Date.now(),
): Promise<RetainedWahooTrainingCompletionResult> {
  const workoutId = exactWahooId(workoutIdValue);
  const planId = exactWahooId(planIdValue);
  const workoutToken = exactWorkoutToken(workoutTokenValue);
  const workoutSummaryId = exactWahooId(workoutSummaryIdValue);
  if (!workoutId || !planId || !workoutToken || !workoutSummaryId) {
    return { retained: false, linkedWorkoutIds: [] };
  }

  const user = db.collection('users').doc(uid);
  const eventRef = user.collection('events').doc(eventId);
  return db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) {
      return { retained: false, linkedWorkoutIds: [] };
    }
    const authority = await readTrainingDeliveryAuthority(db, tx, uid, 'wahoo');
    const [event, meta, tokenRoot] = await Promise.all([
      tx.get(eventRef),
      tx.get(user.collection('meta').doc(ServiceNames.WahooAPI)),
      tx.get(db.collection('wahooAPIAccessTokens').doc(uid)),
    ]);
    if (!event.exists || authority.connection.state !== 'connected'
      || authority.account !== accountGuard.providerUserId || authority.token?.id !== accountGuard.providerUserId
      || generation(meta.data()?.connectionStateGeneration) !== accountGuard.connectionStateGeneration
      || generation(tokenRoot.data()?.activeOAuthCredentialGeneration) !== accountGuard.activeCredentialGeneration) {
      return { retained: false, linkedWorkoutIds: [] };
    }

    const matching = await tx.get(user.collection(DELIVERY_LEDGER)
      .where('provider', '==', 'wahoo')
      .where('destinationKey', '==', authority.connection.destinationKey)
      .where('actual.ids.workout', '==', workoutId)
      .limit(2));
    const candidates = matching.docs.flatMap(document => {
      const candidate = candidateLedger(
        document,
        authority.connection.destinationKey,
        workoutId,
        planId,
        workoutToken,
      );
      return candidate ? [candidate] : [];
    });
    // A remote Workout ID is unique within one Wahoo account. More than one
    // ledger, or one ledger whose Plan/token association disagrees, is a
    // collision rather than permission to select the closest-looking row.
    const candidate = matching.size === 1 && candidates.length === 1 ? candidates[0] : null;
    const reverseId = reverseLinkId(uid, eventId);
    const related = candidate ? await Promise.all([
      tx.get(user.collection('scheduledWorkouts').doc(candidate.ledger.workoutId)),
      tx.get(user.collection(TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID).doc(candidate.ledger.workoutId)),
      tx.get(user.collection(TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID).doc(reverseId)),
    ]) : null;

    let outcome: 'linked' | 'already_linked' | 'missing' | 'conflict' | 'workout_unavailable' = matching.size > 0
      && !candidate ? 'conflict' : 'missing';
    const linkedWorkoutIds: string[] = [];
    if (candidate && related) {
      const [workoutDocument, completionDocument, reverseDocument] = related;
      if (!workoutDocument.exists) outcome = 'workout_unavailable';
      else {
        let workout: ReturnType<typeof parseScheduledWorkoutV1> | null = null;
        try {
          workout = parseScheduledWorkoutV1(workoutDocument.data());
        } catch {
          outcome = 'conflict';
        }
        if (workout && workout.id !== candidate.ledger.workoutId) outcome = 'conflict';
        else if (workout?.lifecycle === 'deleted') outcome = 'workout_unavailable';
        else if (workout) {
          let existingCompletion: TrainingWorkoutCompletionV1 | null = null;
          try {
            existingCompletion = completionDocument.exists
              ? parseTrainingWorkoutCompletionV1(completionDocument.data()) : null;
          } catch {
            outcome = 'conflict';
          }
          const reverse = reverseDocument.data() as {
            schemaVersion?: unknown;
            deliveryId?: unknown;
            workoutId?: unknown;
            eventId?: unknown;
            sourceSessionIndex?: unknown;
            provider?: unknown;
          } | undefined;
          const sameCompletion = existingCompletion?.workoutId === workout.id
            && existingCompletion.eventId === eventId
            && existingCompletion.provider === 'wahoo'
            && existingCompletion.matchMethod === 'provider_marker'
            && existingCompletion.sourceSessionIndex === null;
          const sameReverse = reverse?.schemaVersion === 1 && reverse.deliveryId === candidate.ledger.id
            && reverse.workoutId === workout.id && reverse.eventId === eventId
            && reverse.sourceSessionIndex === null && reverse.provider === 'wahoo';
          // Do not let a retained Workout from an earlier plan/date occurrence
          // complete the current one before the provider copy is updated.
          if (!sameCompletion && (workout.planId !== candidate.ledger.planId
            || workout.localDate !== candidate.artifact.localDate)) outcome = 'conflict';
          if (outcome !== 'conflict' && ((completionDocument.exists && !sameCompletion)
            || (reverseDocument.exists && !sameReverse))) outcome = 'conflict';
          if (outcome !== 'conflict') {
            const activity = activities.length === 1 ? activities[0] : null;
            const completion: TrainingWorkoutCompletionV1 = existingCompletion ?? {
              schemaVersion: 1,
              workoutId: workout.id,
              planId: workout.planId,
              provider: 'wahoo',
              matchMethod: 'provider_marker',
              eventId,
              activityId: activity?.id ?? null,
              sourceSessionIndex: null,
              activityStartAtMs: activity?.startTimeMs ?? null,
              scheduledLocalDate: workout.localDate,
              workoutRevisionAtLink: workout.revision,
              timing: completionTiming(workout.localDate, activity?.startTimeMs ?? null, candidate.ledger.timeZone),
              linkedAtMs: nowMs,
              updatedAtMs: nowMs,
            };
            tx.set(user.collection(TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID).doc(workout.id), completion);
            tx.set(user.collection(TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID).doc(reverseId), {
              schemaVersion: 1,
              deliveryId: candidate.ledger.id,
              workoutId: workout.id,
              eventId,
              activityId: completion.activityId,
              sourceSessionIndex: null,
              provider: 'wahoo',
              linkedAtMs: completion.linkedAtMs,
            });
            const completedLedger: DeliveryLedgerV1 = {
              ...candidate.ledger,
              // A provider summary may already protect the copy before this
              // event is imported. In that case the activity link is real,
              // but its deletion must not clear provider-owned protection.
              ...(candidate.artifact.completed ? {} : { completionLinkId: reverseId }),
              desired: 'preserve',
              status: 'completed',
              actual: { ...candidate.artifact, completed: true },
              retries: 0,
              retryAtMs: 0,
              providerNotBeforeMs: 0,
              updatedAtMs: nowMs,
            };
            tx.set(user.collection(DELIVERY_LEDGER).doc(candidate.ledger.id), completedLedger);
            tx.set(user.collection('trainingDeliveryStatuses').doc(candidate.ledger.id), projectDelivery(completedLedger));
            linkedWorkoutIds.push(workout.id);
            outcome = existingCompletion ? 'already_linked' : 'linked';
          }
        }
      }
    }

    tx.set(eventRef.collection('trainingCompletionEvidence').doc('wahoo'), {
      schemaVersion: 1,
      sourceProvider: 'wahoo',
      accountDigest: createHash('sha256').update(accountGuard.providerUserId).digest('hex'),
      workoutId,
      planId,
      workoutSummaryId,
      workoutTokenDigest: createHash('sha256').update(workoutToken).digest('hex'),
      outcome,
      capturedAtMs: nowMs,
    });
    return { retained: true, linkedWorkoutIds };
  });
}
