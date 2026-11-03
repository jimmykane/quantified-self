import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { DataDistance, DataDuration } from '@sports-alliance/sports-lib/metrics';
import { canonicalizePersistedSportsLibStats } from '../../../shared/sports-lib-metric-semantics';
import { isBenchmarkEventForTrainingMetrics } from '../../../shared/event-classification';
import { TRAINING_GOALS_COLLECTION, TRAINING_GOALS_LIMIT, TRAINING_GOAL_STORED_FIELDS,
  TRAINING_GOAL_STATE_PATH, parseTrainingGoalV1, type TrainingGoalV1 } from '../../../shared/training-goals';
import { calculateTrainingGoalProgress, trainingGoalWeek, type TrainingGoalProgressActivity } from '../../../shared/training-goal-progress';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { readDailyWorkoutHistoryImportActive } from '../assistant/daily-workout-suggestion-store';

export interface TrainingGoalSnapshot { revision: number; goals: TrainingGoalV1[] }
export async function readTrainingGoalSnapshotInTransaction(db: FirebaseFirestore.Firestore,
  tx: FirebaseFirestore.Transaction, uid: string): Promise<TrainingGoalSnapshot> {
  if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) throw Error('Goals are unavailable.');
  const user = db.collection('users').doc(uid);
  const [state, goals] = await Promise.all([tx.get(db.doc(`users/${uid}/${TRAINING_GOAL_STATE_PATH}`)),
    tx.get(user.collection(TRAINING_GOALS_COLLECTION).select(...TRAINING_GOAL_STORED_FIELDS).limit(TRAINING_GOALS_LIMIT + 1))]);
  if (goals.size > TRAINING_GOALS_LIMIT) throw Error('The goal list exceeds the supported limit.');
  const revision = state.exists ? state.get('revision') : 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw Error('The goal state is invalid.');
  return { revision, goals: goals.docs.map(doc => parseTrainingGoalV1(doc.data(), doc.id)) };
}
export function readTrainingGoalSnapshot(uid: string, db = admin.firestore()): Promise<TrainingGoalSnapshot> {
  return db.runTransaction(tx => readTrainingGoalSnapshotInTransaction(db, tx, uid), { readOnly: true });
}
export interface TrainingGoalProgressRequest { localDate: string; timeZone: string; weekStartsOn?: number }
const timeMs = (value: unknown): number | null => {
  const result = value instanceof Date ? value.getTime() : value && typeof value === 'object'
    && 'toMillis' in value && typeof value.toMillis === 'function' ? value.toMillis() : typeof value === 'number' ? value : null;
  return typeof result === 'number' && Number.isFinite(result) ? result : null;
};
/** One bounded, consistent summary read for all goals. No streams, titles, location or provider identifiers. */
export async function readTrainingGoalsProgress(uid: string, request: TrainingGoalProgressRequest, db = admin.firestore()) {
  new Intl.DateTimeFormat('en-CA', { timeZone: request.timeZone }).format();
  return db.runTransaction(async tx => {
    const snapshot = await readTrainingGoalSnapshotInTransaction(db, tx, uid);
    const user = db.collection('users').doc(uid);
    const settings = await tx.get(user.collection('config').doc('settings'));
    const weekStartsOn = request.weekStartsOn ?? settings.get('unitSettings.startOfTheWeek') ?? 1;
    const week = trainingGoalWeek(request.localDate, weekStartsOn);
    const targets = snapshot.goals.filter(goal => goal.lifecycle === 'active' && goal.weeklyTarget);
    if (!targets.length) return { ...snapshot, progress: [], weekStartsOn, complete: true };
    if (await readDailyWorkoutHistoryImportActive(uid, db, tx)) {
      return { ...snapshot, weekStartsOn, complete: false, progress: calculateTrainingGoalProgress({ goals: targets,
        activities: [], localDate: request.localDate, timeZone: request.timeZone, weekStartsOn, complete: false }) };
    }
    // The two-day margin covers every IANA UTC offset. Exact local labels are filtered by the shared calculator.
    const from = new Date(Date.parse(`${week.startLocalDate}T00:00:00Z`) - 2 * 86400000);
    const to = new Date(Date.parse(`${week.endLocalDate}T00:00:00Z`) + 2 * 86400000);
    const page = await tx.get(user.collection('activities').where('eventStartDate', '>=', from)
      .where('eventStartDate', '<', to).orderBy('eventStartDate').orderBy(FieldPath.documentId()).limit(1501)
      .select('eventID', 'eventStartDate', 'type', new FieldPath('stats', DataDuration.type), new FieldPath('stats', DataDistance.type)));
    const rows = page.docs.slice(0, 1500);
    const eventIds = [...new Set(rows.map(row => row.get('eventID')).filter((id): id is string =>
      typeof id === 'string' && id.length > 0 && !id.includes('/')))];
    const parents = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (let offset = 0; offset < eventIds.length; offset += 100) {
      const docs = await tx.getAll(...eventIds.slice(offset, offset + 100).map(id => user.collection('events').doc(id)),
        { fieldMask: ['mergeType', 'isMerge'] });
      docs.forEach(doc => parents.set(doc.id, doc));
    }
    let complete = page.size <= 1500;
    const activities: TrainingGoalProgressActivity[] = [];
    for (const row of rows) {
      const parent = parents.get(row.get('eventID'));
      const start = timeMs(row.get('eventStartDate'));
      if (!parent?.exists || start === null || typeof row.get('type') !== 'string') { complete = false; continue; }
      if (isBenchmarkEventForTrainingMetrics(parent.data())) continue;
      const stats = canonicalizePersistedSportsLibStats(row.get('stats') ?? {}, [row.get('type')]);
      const metric = (name: string): number | null => typeof stats[name] === 'number'
        && Number.isFinite(stats[name]) && stats[name] >= 0 ? stats[name] as number : null;
      activities.push({ activityId: row.id, recordingId: parent.id, recordingStartMs: start, sport: row.get('type'),
        duration: metric(DataDuration.type), distance: metric(DataDistance.type) });
    }
    return { ...snapshot, weekStartsOn, complete, progress: calculateTrainingGoalProgress({ goals: targets,
      activities, localDate: request.localDate, timeZone: request.timeZone, weekStartsOn, complete }) };
  }, { readOnly: true });
}
