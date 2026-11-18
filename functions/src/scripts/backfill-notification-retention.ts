import { FieldPath, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { notificationExpiry, trainingIssueExpiry, trainingResultExpiry } from '../web-push/retention';

const roots = /^(activitySync|activityDelivery|trainingSync|sleepReady|connectionAttention|historyCompletion|testRateLimit|trainingSend_[a-zA-Z0-9_-]+)$/;
/** One-time, paginated migration; dry-run by default. No recurring account scan or new scheduled Function. */
export async function backfillNotificationRetention(db: Firestore, apply = false, now = Date.now()) {
  const totals = { inspected: 0, changed: 0 };
  for (const group of ['pushState', 'issues']) {
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    while (true) {
      let query = db.collectionGroup(group).orderBy(FieldPath.documentId()).limit(100).select('expireAt');
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      for (const row of page.docs) {
        const root = /^users\/([^/]+)\/pushState\/([^/]+)$/.exec(row.ref.path);
        const issue = /^users\/([^/]+)\/pushState\/trainingSync\/issues\/([^/]+)$/.exec(row.ref.path);
        if (!issue && (!root || !roots.test(root[2]))) continue;
        totals.inspected++;
        const changed = await db.runTransaction(async tx => {
          const current = await tx.get(row.ref), data = current.data();
          if (!data) return false;
          const patch: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {};
          const history: FirebaseFirestore.DocumentSnapshot[] = [];
          if (!data.expireAt) {
            if (issue) {
              const ledger = await tx.get(db.doc(`users/${issue[1]}/trainingDeliveryLedger/${issue[2]}`));
              const workoutId = ledger.get('workoutId');
              const workout = typeof workoutId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(workoutId)
                ? await tx.get(db.doc(`users/${issue[1]}/scheduledWorkouts/${workoutId}`)) : undefined;
              patch.expireAt = trainingIssueExpiry(now, workout?.get('localDate') ?? new Date(now).toISOString().slice(0, 10));
            } else {
              patch.expireAt = root![2].startsWith('trainingSend_') && Number.isSafeInteger(data.createdAt)
                ? trainingResultExpiry(data.createdAt) : notificationExpiry(now);
              if (root![2] === 'historyCompletion') {
                const ids = Object.values(data.providers ?? {}).map(value => (value as { runId?: string }).runId)
                  .filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id));
                if (ids.length) history.push(...await tx.getAll(...ids.slice(0, 3).map(id => db.doc(`connectionHistoryImports/${id}`))));
              }
            }
          }
          // Existing queued records join the same dueAt index before their old schedules are retired.
          const legacyDue = data.deliveryDueAt ?? data.trainingDueAt;
          if (Number.isFinite(legacyDue) && data.pending) patch.dueAt = legacyDue;
          for (const field of ['deliveryDueAt', 'trainingDueAt']) if (field in data) patch[field] = FieldValue.delete();
          if (!Object.keys(patch).length) return false;
          if (apply) {
            for (const run of history) if (run.exists && run.get('userID') === root![1] && run.get('notificationAttemptedAtMs') === undefined) {
              tx.update(run.ref, { notificationAttemptedAtMs: now });
            }
            tx.update(row.ref, patch);
          }
          return true;
        });
        if (changed) totals.changed++;
      }
      cursor = page.docs[page.docs.length - 1];
    }
  }
  return totals;
}

if (require.main === module) {
  void (async () => {
    const args = process.argv.slice(2), project = args.find(arg => arg.startsWith('--project='))?.slice(10);
    if (!project || !(project === 'quantified-self-io' || /^demo-[a-z0-9-]+$/.test(project))
      || args.some(arg => arg !== '--apply' && !arg.startsWith('--project='))) throw new Error('Use --project=quantified-self-io (or demo-*) and optional --apply.');
    const { initializeApp } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore(initializeApp({ projectId: project }));
    console.log(JSON.stringify({ apply: args.includes('--apply'), ...await backfillNotificationRetention(db, args.includes('--apply')) }));
    await db.terminate();
  })().catch(() => { console.error('Notification retention migration failed.'); process.exitCode = 1; });
}
