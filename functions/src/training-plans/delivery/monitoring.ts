import * as logger from 'firebase-functions/logger';
import { DELIVERY_QUEUE } from './contracts';

const PROBE_TIMEOUT_MS = 5_000;

function safeCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid queue sample');
  return value as number;
}

/** One index count + two masked single-document queries; no owner/ledger reads or writes. */
export async function observeTrainingQueueHealth(db: FirebaseFirestore.Firestore, now: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    safeCount(now);
    const queue = db.collection(DELIVERY_QUEUE);
    const sample = Promise.all([
      queue.where('dueAtMs', '<=', now).count().get(),
      queue.where('dueAtMs', '>', 0).where('dueAtMs', '<=', now)
        .orderBy('dueAtMs').select('dueAtMs').limit(1).get(),
      queue.where('dueAtMs', '<=', 0).orderBy('dueAtMs').select('dueAtMs').limit(1).get(),
    ]);
    const [count, dated, immediate] = await Promise.race([
      sample,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Queue sample deadline')), PROBE_TIMEOUT_MS);
      }),
    ]);
    const dueJobs = safeCount(count.data().count);
    let dueAgeLowerBoundMs = 0;
    if (dated.docs[0]) {
      const dueAt = safeCount(dated.docs[0].get('dueAtMs'));
      if (dueAt === 0 || dueAt > now) throw new Error('Invalid dated queue sample');
      dueAgeLowerBoundMs = now - dueAt;
    }
    // Zero is an immediate-work marker, not an epoch timestamp. Reconciliation
    // documents are reused, so creation time can predate the current pending work.
    // Last write time is conservative; IDs aren't chronological, so this sample
    // cannot claim the exact oldest zero job.
    let immediateAgeKnown = true;
    if (immediate.docs[0]) {
      if (immediate.docs[0].get('dueAtMs') !== 0) throw new Error('Invalid immediate queue sample');
      const updatedAt = immediate.docs[0].updateTime?.toMillis();
      // A concurrent enqueue/update can occur after the probe's query cutoff.
      // Within this bounded probe window it is new work, not corrupt telemetry.
      immediateAgeKnown = Number.isSafeInteger(updatedAt) && updatedAt! >= 0 && updatedAt! <= now + PROBE_TIMEOUT_MS;
      if (immediateAgeKnown) dueAgeLowerBoundMs = Math.max(dueAgeLowerBoundMs, now - updatedAt!, 0);
    }
    // Queries aren't a transaction; a job can disappear between the reads.
    // A zero due count must never produce a backlog incident from a stale age.
    if (dueJobs === 0) dueAgeLowerBoundMs = 0;
    logger.info('[TrainingDelivery]', {
      event: 'queue_health', telemetryVersion: 1, dueJobs, dueAgeLowerBoundMs, immediateAgeKnown,
    });
  } catch {
    // Monitoring failure must not stop delivery or serialize private exceptions.
    logger.warn('[TrainingDelivery]', { event: 'queue_health_unavailable', telemetryVersion: 1 });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
