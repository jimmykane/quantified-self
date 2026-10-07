import { Injectable, inject } from '@angular/core';
import { Auth } from 'app/firebase/auth';
import { Firestore, doc, runTransaction, collection, query, where, limit, getDocsFromServer } from 'app/firebase/firestore';
import { firstValueFrom, from, timeout } from 'rxjs';
import { isBenchmarkEvent } from '@shared/event-classification';
import { WORKOUT_REFLECTION_COLLECTION, decodeWorkoutReflection, nextWorkoutReflection, reflectionDocumentId,
  type WorkoutReflectionFields, type WorkoutReflectionTarget } from '@shared/workout-reflection';
import { parseTrainingWorkoutCompletionV1, TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID } from '@shared/training-workout-completion';
import { sanitizeEventFirestoreWritePayload } from '@shared/firestore-write-sanitizer';
import { eventDetailsWritePatch, type EventDetailsChanges } from '../helpers/event-details-form.helper';

export interface ReflectionRecording { uid: string; eventId: string; activityId: string; target: WorkoutReflectionTarget }
export interface ReflectionChange { expectedRevision: number; mutationId: string; fields: WorkoutReflectionFields; deleted: boolean }
export const WORKOUT_REFLECTION_READ_TIMEOUT_MS = 30_000;
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
    const reference = this.ref(recording);
    // The full SDK's watch/local-store path can repeat a persisted missing leaf.
    // Lite reads use the same app's Auth/App Check providers without that cache.
    const snapshot = await firstValueFrom(from((async () => {
      const { getFirestore, doc, getDoc } = await import('firebase/firestore/lite');
      this.assertOwner(recording.uid);
      return getDoc(doc(getFirestore(this.db.app), reference.path));
    })()).pipe(timeout(WORKOUT_REFLECTION_READ_TIMEOUT_MS)));
    this.assertOwner(recording.uid);
    const reflection = snapshot.exists() ? decodeWorkoutReflection(snapshot.data()) : null;
    if (snapshot.exists() && !reflection) throw new Error('The saved reflection could not be read safely.');
    return reflection;
  }
  async save(recording: ReflectionRecording, expectedRevision: number, mutationId: string,
    fields: WorkoutReflectionFields, deleted = false) {
    return this.write(recording, { expectedRevision, mutationId, fields, deleted });
  }
  /** The app editor saves event feedback and its private note atomically. MCP note writes remain independent. */
  async saveEventDetails(recording: ReflectionRecording, changes: EventDetailsChanges, reflection?: ReflectionChange) {
    return this.write(recording, reflection, changes);
  }
  private async write(recording: ReflectionRecording, reflection?: ReflectionChange, changes: EventDetailsChanges = {}) {
    const ref = this.ref(recording);
    const result = await runTransaction(this.db, async transaction => {
      this.assertOwner(recording.uid);
      const eventRef = doc(this.db, 'users', recording.uid, 'events', recording.eventId);
      const event = await transaction.get(eventRef);
      const activity = reflection && recording.target === 'activity'
        ? await transaction.get(doc(this.db, 'users', recording.uid, 'activities', recording.activityId)) : null;
      const snapshot = reflection ? await transaction.get(ref) : null;
      this.assertOwner(recording.uid);
      if (!event.exists() || (reflection && isBenchmarkEvent(event.data()))
        || (activity && (!activity.exists() || activity.data().eventID !== recording.eventId))) {
        throw new Error('This recording is no longer available for editing.');
      }
      const current = snapshot?.exists() ? decodeWorkoutReflection(snapshot.data()) : null;
      if (snapshot?.exists() && !current) throw new Error('Reload the reflection before editing.');
      const next = reflection ? nextWorkoutReflection(current, reflection.expectedRevision, reflection.mutationId,
        reflection.fields, reflection.deleted) : null;
      const patch = sanitizeEventFirestoreWritePayload(eventDetailsWritePatch(event.data(), changes));
      // Resolve every precondition before scheduling either write: a conflict cannot partially save the form.
      if (Object.keys(patch).length) transaction.update(eventRef, patch);
      if (reflection && next !== current) transaction.set(ref, next);
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
    let matches = 0;
    for (const snapshot of result.docs) {
      try {
        const link = parseTrainingWorkoutCompletionV1(snapshot.data());
        if (link.eventId !== recording.eventId) return false;
        if (recording.target === 'recording' ? link.activityId === null : link.activityId === recording.activityId) {
          matches++;
        }
      } catch { return false; }
    }
    return matches === 1;
  }
}
