import { randomUUID, createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { dayWorkoutDateOffset, type DayWorkoutControls, type GenerateDayWorkoutResponse } from '../../../shared/day-workout';
import { parseDailyWorkoutSuggestionPreferences, type DailyWorkoutSuggestionPreferences, type DailyWorkoutSuggestionStatus } from '../../../shared/daily-workout-suggestion';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { TTL_CONFIG } from '../shared/ttl-config';

interface Entry extends DailyWorkoutSuggestionStatus { token: string; startedAtMs: number; charged: boolean; preferenceHash: string; awaitingSleep?: true }
// A date-keyed map under the existing index-exempt messages field; this leaf is not a chat transcript.
interface State { version: 'daily-workout-suggestion-v1'; messages: Record<string, Entry>; expireAt: Timestamp }
const fingerprint = (value: DailyWorkoutSuggestionPreferences) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const LEASE_MS = 4 * 60_000;
const publicEntry = ({ localDate, state, controls, result }: Entry): DailyWorkoutSuggestionStatus => ({ localDate, state,
  ...(controls ? { controls } : {}), ...(result ? { result } : {}) });

/** Server-only leaf under the existing conversation Rules, seven-day TTL and recursive account erasure. */
export function createDailyWorkoutSuggestionStore(db = () => admin.firestore(), clock = () => new Date()) {
  async function transact<T>(uid: string, action: (preferences: DailyWorkoutSuggestionPreferences | null, state: State, now: Date) =>
    { value: T; write?: boolean }): Promise<T> {
    const database = db();
    return database.runTransaction(async tx => {
      const now = clock();
      const guard = await getUserDeletionGuardStateInTransaction(database, tx, uid, now.getTime());
      if (guard.shouldSkip) throw new HttpsError('permission-denied', 'Daily suggestions are unavailable.');
      const ref = database.doc(`users/${uid}/assistantConversations/daily-workout-suggestion`);
      const [settings, snapshot] = await Promise.all([tx.get(database.doc(`users/${uid}/config/settings`)), tx.get(ref)]);
      let preferences: DailyWorkoutSuggestionPreferences | null = null;
      try { preferences = parseDailyWorkoutSuggestionPreferences(settings.get('appSettings.dailyWorkoutSuggestion'), now); } catch { /* Missing/malformed is off. */ }
      const state = snapshot.data() as State | undefined;
      if (state && state.version !== 'daily-workout-suggestion-v1') throw new HttpsError('failed-precondition', 'Daily suggestion state is unavailable.');
      const next: State = state ?? { version: 'daily-workout-suggestion-v1', messages: {}, expireAt: Timestamp.fromMillis(0) };
      const outcome = action(preferences, next, now);
      if (outcome.write) {
        next.expireAt = Timestamp.fromMillis(now.getTime() + TTL_CONFIG.ASSISTANT_CONVERSATIONS_IN_DAYS * 86_400_000);
        const days = Object.keys(next.messages).sort().reverse();
        // Keep receipts even when old full responses are removed. Never regenerate an evicted date.
        for (const day of days.slice(4)) { delete next.messages[day].result; delete next.messages[day].controls; }
        for (const day of days.slice(8)) delete next.messages[day];
        while (Buffer.byteLength(JSON.stringify(next), 'utf8') > 400_000) {
          const old = days.slice().reverse().find(day => next.messages[day]?.result && day !== preferences?.controls.localDate);
          if (!old) throw new HttpsError('resource-exhausted', 'Daily suggestion is too large.');
          delete next.messages[old].result; delete next.messages[old].controls;
        }
        tx.set(ref, next);
      }
      return outcome.value;
    });
  }
  function active(preferences: DailyWorkoutSuggestionPreferences | null, state: State, date: string, token: string, now: Date): Entry {
    const entry = state.messages[date];
    if (!preferences?.enabled || preferences.controls.localDate !== date || !entry || entry.token !== token
      || entry.state !== 'preparing' || !Number.isFinite(entry.startedAtMs) || now.getTime() - entry.startedAtMs >= LEASE_MS
      || entry.preferenceHash !== fingerprint(preferences)) throw new HttpsError('aborted', 'The daily suggestion changed or expired.');
    return entry;
  }
  return {
    read: (uid: string) => transact<{ preferences: DailyWorkoutSuggestionPreferences | null; status: DailyWorkoutSuggestionStatus }>(uid, (preferences, state, now) => {
      if (!preferences?.enabled) return { value: { preferences: null, status: { localDate: '', state: 'off' } as DailyWorkoutSuggestionStatus } };
      const date = preferences.controls.localDate;
      const entry = state.messages[date];
      const status: DailyWorkoutSuggestionStatus = entry ? publicEntry(entry) : { localDate: date, state: 'waiting' };
      // Coverage is rechecked by the caller. Preserve earlier deferral if that temporary coverage is removed.
      if (entry?.awaitingSleep === true && entry.charged === false && ['planned', 'completed', 'rest-day'].includes(entry.state)) {
        status.state = 'waiting-sleep';
      }
      if (entry?.state === 'preparing' && (!Number.isFinite(entry.startedAtMs) || now.getTime() - entry.startedAtMs >= LEASE_MS)) {
        status.state = Number.isFinite(entry.startedAtMs) && entry.charged === false
          ? entry.awaitingSleep === true ? 'waiting-sleep' : 'waiting' : 'failed';
      }
      if (status.state === 'ready' && !status.result) status.state = 'failed';
      return { value: { preferences, status } };
    }),
    begin: (uid: string, expected: DailyWorkoutSuggestionPreferences) => transact<string | null>(uid, (preferences, state, now) => {
      if (!preferences?.enabled || fingerprint(preferences) !== fingerprint(expected)) throw new HttpsError('aborted', 'Daily preferences changed.');
      const date = preferences.controls.localDate;
      const existing = state.messages[date];
      const reclaimable = existing && existing.charged === false && (['planned', 'completed', 'rest-day', 'waiting-sleep'].includes(existing.state)
        || existing.state === 'preparing' && Number.isFinite(existing.startedAtMs) && now.getTime() - existing.startedAtMs >= LEASE_MS);
      if (existing && !reclaimable) return { value: null };
      for (const day of Object.keys(state.messages)) if (day < dayWorkoutDateOffset(date, -7)) delete state.messages[day];
      const token = randomUUID();
      state.messages[date] = { localDate: date, state: 'preparing', token, startedAtMs: now.getTime(), charged: false,
        preferenceHash: fingerprint(preferences), ...(existing?.awaitingSleep === true ? { awaitingSleep: true } : {}) };
      return { value: token, write: true };
    }),
    assertActive: (uid: string, date: string, token: string) => transact(uid, (preferences, state, now) => {
      active(preferences, state, date, token, now); return { value: undefined };
    }),
    charge: (uid: string, date: string, token: string) => transact(uid, (preferences, state, now) => {
      active(preferences, state, date, token, now).charged = true; return { value: undefined, write: true };
    }),
    finish: (uid: string, date: string, token: string, outcome: DailyWorkoutSuggestionStatus['state'],
      controls?: DayWorkoutControls, result?: GenerateDayWorkoutResponse) => transact(uid, (preferences, state, now) => {
      const current = state.messages[date];
      // A source-choice change can cancel uncharged work without spending the daily allowance.
      if (outcome === 'failed' && current?.token === token && current.charged === false) {
        if (current.awaitingSleep === true) current.state = 'waiting-sleep';
        else delete state.messages[date];
        return { value: undefined, write: true };
      }
      const entry = active(preferences, state, date, token, now);
      if (outcome === 'waiting-sleep') entry.awaitingSleep = true;
      entry.state = outcome; if (controls) entry.controls = controls; if (result) entry.result = result;
      return { value: undefined, write: true };
    }),
    dismiss: (uid: string, expectedDate: string) => transact(uid, (preferences, state, now) => {
      if (!preferences?.enabled) throw new HttpsError('failed-precondition', 'Daily suggestions are off.');
      const date = preferences.controls.localDate;
      if (date !== expectedDate) throw new HttpsError('aborted', 'The day changed. Review today before dismissing.');
      state.messages[date] = { localDate: date, state: 'dismissed', token: randomUUID(), startedAtMs: now.getTime(), charged: true,
        preferenceHash: fingerprint(preferences) };
      return { value: { localDate: date, state: 'dismissed' } as DailyWorkoutSuggestionStatus, write: true };
    }),
  };
}
export type DailyWorkoutSuggestionStore = ReturnType<typeof createDailyWorkoutSuggestionStore>;
