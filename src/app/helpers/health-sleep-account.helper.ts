import type { SleepSession } from '@shared/sleep';
import { nightlyHealthAccountKey, sleepEvidenceSourceKey } from '@shared/nightly-hrv';

/** Read-time identities shared with typed Health references; never persisted. */
export type HealthWorkspaceSleepSession = SleepSession & {
  healthAccountKey?: string;
  nightlyHrvSourceKey?: string;
};

/** Match frontend Sleep consumers to Health without additional reads or stored fields. */
export function withHealthSleepAccountKeys(
  uid: string,
  sessions: readonly HealthWorkspaceSleepSession[],
): Promise<HealthWorkspaceSleepSession[]> {
  const accounts = new Map<string, Promise<string | undefined>>();
  return Promise.all(sessions.map(session => {
    const providerAccountId = session.source?.providerUserId;
    if (session.healthAccountKey || !providerAccountId || (session.userID && session.userID !== uid)) return session;
    const key = sleepEvidenceSourceKey(session);
    // Keep native Sleep usable when secure account matching is unavailable.
    if (!accounts.has(key)) accounts.set(key,
      nightlyHealthAccountKey(uid, session.source.provider, providerAccountId).catch(() => undefined));
    return accounts.get(key)!.then(healthAccountKey => healthAccountKey ? { ...session, healthAccountKey } : session);
  }));
}
