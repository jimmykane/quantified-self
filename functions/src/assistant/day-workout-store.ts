import { createHash, randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { GenerateDayWorkoutRequest, GenerateDayWorkoutResponse } from '../../../shared/day-workout';
import { TTL_CONFIG } from '../shared/ttl-config';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';

const RETENTION_MS = TTL_CONFIG.ASSISTANT_CONVERSATIONS_IN_DAYS * 86_400_000;
const LEASE_MS = 4 * 60_000;
const MAX_STATE_BYTES = 400_000;
interface Receipt { requestId: string; fingerprint: string; createdAtMs: number; status: 'running' | 'done' | 'failed' }
interface State {
  version: 'day-workout-v1';
  replayReceipts: Receipt[];
  messages: { requestId: string; response: GenerateDayWorkoutResponse }[];
  pendingTurn: { requestId: string; token: string; startedAtMs: number } | null;
  expireAt: Timestamp;
}
export interface DayWorkoutStore {
  begin(uid: string, request: GenerateDayWorkoutRequest): Promise<{ token: string } | { response: GenerateDayWorkoutResponse }>;
  assertActive(uid: string, requestId: string, token: string): Promise<void>;
  finish(uid: string, requestId: string, token: string, response: GenerateDayWorkoutResponse | null): Promise<void>;
}
/** A separate bounded leaf reuses the existing private Rules, TTL and recursive account erasure. */
export function createDayWorkoutStore(db: () => FirebaseFirestore.Firestore = () => admin.firestore(),
  clock = () => Date.now()): DayWorkoutStore {
  async function transaction<T>(uid: string, action: (state: State, now: number) => { value: T; write?: boolean }): Promise<T> {
    const database = db();
    return database.runTransaction(async tx => {
      const now = clock();
      const guard = await getUserDeletionGuardStateInTransaction(database, tx, uid, now);
      if (guard.shouldSkip) throw new HttpsError('permission-denied', 'Workout generation is unavailable for this account.');
      const ref = database.doc(`users/${uid}/assistantConversations/day-workout`);
      const snapshot = await tx.get(ref);
      const data = snapshot.data() as State | undefined;
      if (data && data.version !== 'day-workout-v1') throw new HttpsError('failed-precondition', 'Generation state is unavailable.');
      const state: State = data ?? { version: 'day-workout-v1', replayReceipts: [], messages: [], pendingTurn: null,
        expireAt: Timestamp.fromMillis(now + RETENTION_MS) };
      state.replayReceipts = state.replayReceipts.filter(item => item.createdAtMs > now - RETENTION_MS);
      state.messages = state.messages.filter(item => state.replayReceipts.some(receipt => receipt.requestId === item.requestId));
      const result = action(state, now);
      if (result.write) {
        state.expireAt = Timestamp.fromMillis(now + RETENTION_MS);
        const size = () => Buffer.byteLength(JSON.stringify(state), 'utf8');
        // Evict older full replies before rejecting new work. Receipts still prevent re-generation.
        while (state.messages.length > 1 && size() > MAX_STATE_BYTES) state.messages.shift();
        if (size() > MAX_STATE_BYTES) throw new HttpsError('resource-exhausted', 'Generation state is full. Try again later.');
        tx.set(ref, state);
      }
      return result.value;
    });
  }
  function requireActive(state: State, requestId: string, token: string, now: number): void {
    if (state.pendingTurn?.requestId !== requestId || state.pendingTurn.token !== token
      || now - state.pendingTurn.startedAtMs >= LEASE_MS) throw new HttpsError('aborted', 'The generation expired. Generate again.');
  }
  return {
    begin: (uid, request) => transaction<{ token: string } | { response: GenerateDayWorkoutResponse }>(uid, (state, now) => {
      const fingerprint = createHash('sha256').update(JSON.stringify(request.controls)).digest('hex');
      const receipt = state.replayReceipts.find(item => item.requestId === request.requestId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new HttpsError('invalid-argument', 'This request identifier belongs to different controls.');
        const cached = state.messages.find(item => item.requestId === request.requestId);
        if (cached) return { value: { response: cached.response } };
        if (receipt.status === 'running' && state.pendingTurn?.requestId === request.requestId
          && now - state.pendingTurn.startedAtMs < LEASE_MS) throw new HttpsError('aborted', 'This workout is still generating. Retry the same request shortly.');
        throw new HttpsError('failed-precondition', 'This generation cannot be replayed. Use Generate again for a new request.');
      }
      if (state.pendingTurn && now - state.pendingTurn.startedAtMs < LEASE_MS) throw new HttpsError('aborted', 'Another workout is still generating. Try again shortly.');
      if (state.replayReceipts.length >= 128) throw new HttpsError('resource-exhausted', 'Too many recent generation requests. Try again later.');
      const token = randomUUID();
      state.pendingTurn = { requestId: request.requestId, token, startedAtMs: now };
      state.replayReceipts.push({ requestId: request.requestId, fingerprint, createdAtMs: now, status: 'running' });
      return { value: { token }, write: true };
    }),
    assertActive: (uid, requestId, token) => transaction(uid, (state, now) => {
      requireActive(state, requestId, token, now); return { value: undefined };
    }),
    finish: (uid, requestId, token, response) => transaction(uid, (state, now) => {
      requireActive(state, requestId, token, now);
      const receipt = state.replayReceipts.find(item => item.requestId === requestId);
      if (!receipt) throw new HttpsError('aborted', 'The generation expired.');
      receipt.status = response ? 'done' : 'failed';
      if (response) state.messages = [...state.messages, { requestId, response }].slice(-4);
      state.pendingTurn = null;
      return { value: undefined, write: true };
    }),
  };
}
