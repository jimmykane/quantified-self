import * as admin from 'firebase-admin';
import { SCHEDULED_WORKOUTS_COLLECTION_ID } from '../../../shared/training-plans';
import {
    TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID,
    TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID,
} from '../../../shared/training-workout-completion';

/** Idempotent subtree cleanup; the durable cleanup job retries any interrupted page. */
export async function cleanupPermanentlyDeletedWorkoutData(
    db: admin.firestore.Firestore,
    uid: string,
    workoutId: string,
): Promise<void> {
    const user = db.collection('users').doc(uid);
    const reverseLinks = user.collection(TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID);
    while (true) {
        const page = await reverseLinks.where('workoutId', '==', workoutId).limit(25).get();
        if (page.empty) break;
        await Promise.all(page.docs.map(snapshot => db.recursiveDelete(snapshot.ref)));
    }
    await db.recursiveDelete(user.collection(TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID).doc(workoutId));
    await db.recursiveDelete(user.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(workoutId));
}
