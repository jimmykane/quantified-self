import type * as admin from 'firebase-admin';
import type { EventInterface } from '@sports-alliance/sports-lib';

export class EventWriteSkippedForDeletedEventError extends Error {
  readonly name = 'EventWriteSkippedForDeletedEventError';
  constructor(uid: string, eventId: string) {
    super(`Skipping source rewrite because event ${eventId} of user ${uid} no longer exists.`);
  }
}

export type PreparedTrainingLoadWrite = (() => Promise<void>) & {
  readonly sourceWriteId: string;
};

/** One instance per import attempt. Check inside every source/cleanup transaction, before writes. */
export class TrainingLoadSourceWrite {
  private reservation?: { eventId: string; sourceWriteId: string };

  constructor(private readonly uid: string,
    private readonly prepare: (event: EventInterface) => Promise<PreparedTrainingLoadWrite>) {}

  prepareTrainingLoad = async (event: EventInterface): Promise<PreparedTrainingLoadWrite> => {
    const finish = await this.prepare(event);
    this.reservation = { eventId: event.getID()!, sourceWriteId: finish.sourceWriteId };
    return finish;
  };

  assertCurrent = async (db: admin.firestore.Firestore, transaction: admin.firestore.Transaction): Promise<void> => {
    const reservation = this.reservation;
    if (!reservation?.eventId || !reservation.sourceWriteId) throw new Error('Training load source write was not prepared.');
    const snapshot = await transaction.get(db.doc(
      `users/${this.uid}/events/${reservation.eventId}/metaData/trainingLoad`));
    if (snapshot.data()?.sourceWriteId !== reservation.sourceWriteId) {
      throw new Error('Training load source write was superseded; retry the source import.');
    }
  };
}
