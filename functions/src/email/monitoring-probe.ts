import { EMAIL_MONITORING_FIELDS, EMAIL_PROBE_LIMIT, EMAIL_PROBE_TIMEOUT_MS,
  emailEligibility, recordEmailSample, type EmailSample, type EmailSource } from './monitoring';

/** One bounded masked query of actual mail. No writes, SMTP calls or new scheduler. */
export async function observeEmailOutbox(db: FirebaseFirestore.Firestore, now = Date.now()): Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sample = async () => {
    const snapshot = await db.collection('mail').where('delivery.state', 'in', ['PENDING', 'PROCESSING', 'RETRY'])
      .select(...EMAIL_MONITORING_FIELDS).limit(EMAIL_PROBE_LIMIT + 1).get();
    if (stopped) return;
    const groups = new Map<EmailSource, EmailSample>(['transactional', 'marketing'].map(source => [source as EmailSource,
      { sampled: 0, unknownSample: 0, excludedSample: 0, truncated: snapshot.size > EMAIL_PROBE_LIMIT,
        dueSample: 0, ageLowerBoundMs: 0 }]));
    for (const mail of snapshot.docs.slice(0, EMAIL_PROBE_LIMIT)) {
      const result = emailEligibility(mail, now);
      const group = groups.get(result.source)!;
      group.sampled++;
      if (result.kind === 'unknown') group.unknownSample++;
      else if (result.kind === 'excluded') group.excludedSample++;
      else { group.dueSample!++; group.ageLowerBoundMs = Math.max(group.ageLowerBoundMs!, result.ageMs!); }
    }
    for (const [source, group] of groups) {
      if (!group.dueSample && (group.unknownSample || group.truncated)) { delete group.dueSample; delete group.ageLowerBoundMs; }
      recordEmailSample(source, group);
    }
  };
  try {
    await Promise.race([sample(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { stopped = true; reject(new Error('Email observation deadline')); }, EMAIL_PROBE_TIMEOUT_MS);
    })]);
  } catch {
    stopped = true;
    recordEmailSample('transactional'); recordEmailSample('marketing');
  } finally { if (timer) clearTimeout(timer); }
}
