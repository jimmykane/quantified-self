import { Injectable, inject } from '@angular/core';
import { Auth } from 'app/firebase/auth';
import { Firestore, doc, getDocFromServer, runTransaction, collection, query, where, limit, getDocsFromServer } from 'app/firebase/firestore';
import { isBenchmarkEvent } from '@shared/event-classification';
import { WORKOUT_REFLECTION_COLLECTION, decodeWorkoutReflection, nextWorkoutReflection, reflectionDocumentId,
  type WorkoutReflectionFields, type WorkoutReflectionTarget } from '@shared/workout-reflection';
import { parseTrainingWorkoutCompletionV1, TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID } from '@shared/training-workout-completion';

export interface ReflectionRecording { uid: string; eventId: string; activityId: string; target: WorkoutReflectionTarget }
@Injectable({ providedIn: 'root' })
export class WorkoutReflectionService {
  private readonly db = inject(Firestore);
  private readonly auth = inject(Auth);
  private assertOwner(uid: string): void {
    if (!uid || this.auth.currentUser?.uid !== uid) throw new Error('Your account changed. Reopen the reflection.');
  }
  private ref(recording: ReflectionRecording) {
    this.assertOwner(recording.uid);
    if (!recording.eventId || recording.eventId.includes('/')) throw new Error('The recording is invalid.');
    return doc(this.db, 'users', recording.uid, 'events', recording.eventId, WORKOUT_REFLECTION_COLLECTION,
      reflectionDocumentId(recording.target, recording.activityId));
  }
  async read(recording: ReflectionRecording) {
    const snapshot = await getDocFromServer(this.ref(recording));
    this.assertOwner(recording.uid);
    const reflection = snapshot.exists() ? decodeWorkoutReflection(snapshot.data()) : null;
    if (snapshot.exists() && !reflection) throw new Error('The saved reflection could not be read safely.');
    return reflection;
  }
  async save(recording: ReflectionRecording, expectedRevision: number, mutationId: string,
    fields: WorkoutReflectionFields, deleted = false) {
    const ref = this.ref(recording);
    const result = await runTransaction(this.db, async transaction => {
      this.assertOwner(recording.uid);
      const event = await transaction.get(doc(this.db, 'users', recording.uid, 'events', recording.eventId));
      const activity = recording.target === 'activity'
        ? await transaction.get(doc(this.db, 'users', recording.uid, 'activities', recording.activityId)) : null;
      const snapshot = await transaction.get(ref);
      this.assertOwner(recording.uid);
      if (!event.exists() || isBenchmarkEvent(event.data())
        || (activity && (!activity.exists() || activity.data().eventID !== recording.eventId))) {
        throw new Error('This recording is no longer available for reflection.');
      }
      const current = snapshot.exists() ? decodeWorkoutReflection(snapshot.data()) : null;
      if (snapshot.exists() && !current) throw new Error('Reload the reflection before editing.');
      const next = nextWorkoutReflection(current, expectedRevision, mutationId, fields, deleted);
      if (next !== current) transaction.set(ref, next);
      return next;
    });
    this.assertOwner(recording.uid);
    return result;
  }
  /** Exact persisted evidence only. Failure/ambiguity never produces planned-versus-recorded prompts. */
  async hasExactWorkoutLink(recording: ReflectionRecording): Promise<boolean> {
    this.assertOwner(recording.uid);
    const result = await getDocsFromServer(query(collection(this.db, 'users', recording.uid,
      TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID), where('eventId', '==', recording.eventId), limit(26)));
    this.assertOwner(recording.uid);
    if (result.size > 25) return false;
    const matches = result.docs.flatMap(snapshot => {
      try {
        const link = parseTrainingWorkoutCompletionV1(snapshot.data());
        return link.eventId === recording.eventId && (recording.target === 'recording'
          ? link.activityId === null : link.activityId === recording.activityId) ? [link] : [];
      } catch { return []; }
    });
    return matches.length === 1;
  }
}
