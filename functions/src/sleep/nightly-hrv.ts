import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { enrichSleepWithNightlyHrv, nightlyHrvDateRange, NIGHTLY_HRV_LIMITS,
  assertNightlyHrvRecordBudget, type NightlyHrvRecord } from '../../../shared/nightly-hrv';
import { decodeSleepSessionSportsLibData, SportsLibDataValidationError } from '../../../shared/sports-lib-health-data';
import type { SleepSession } from '../../../shared/sleep';

export interface NightlyHrvDocument { id: string; data: Record<string, unknown> }
export interface NightlyHrvPage { records: NightlyHrvRecord[]; cursor?: unknown }
export type FetchNightlyHrvPage = (uid: string, startDate: string, endDate: string, limit: number, cursor?: unknown) => Promise<NightlyHrvPage>;

export const fetchNightlyHrvPage: FetchNightlyHrvPage = async (uid, startDate, endDate, limit, cursor) => {
  const db = admin.firestore();
  if ((await getUserDeletionGuardState(db, uid)).shouldSkip) throw new Error('Nightly Health owner is unavailable.');
  let query = db.collection('users').doc(uid).collection('healthSourceRecords')
    .where('metricIds', 'array-contains', 'heart_rate_variability')
    .where('calendarDate', '>=', startDate).where('calendarDate', '<=', endDate)
    .orderBy('calendarDate').orderBy(FieldPath.documentId()).limit(limit)
    .select('userID', 'schemaVersion', 'kind', 'source.provider', 'source.accountKey',
      'calendarDate', 'startTimeMs', 'endTimeMs', 'metrics');
  if (cursor) query = query.startAfter(cursor as admin.firestore.QueryDocumentSnapshot);
  const docs = (await query.get()).docs;
  if ((await getUserDeletionGuardState(db, uid)).shouldSkip) throw new Error('Nightly Health owner is unavailable.');
  return { records: docs.map(doc => doc.data() as NightlyHrvRecord), cursor: docs[docs.length - 1] };
};

/** Read-only join: no provider requests, persistent cache, source writes or sample reads. */
export async function supplementNightlyHrvSleepDocuments(
  uid: string, documents: readonly NightlyHrvDocument[], fetchPage: FetchNightlyHrvPage = fetchNightlyHrvPage,
): Promise<NightlyHrvDocument[]> {
  const valid: Array<{ index: number; session: SleepSession }> = [];
  documents.forEach((doc, index) => {
    try { valid.push({ index, session: decodeSleepSessionSportsLibData({ ...doc.data, id: doc.id } as unknown as SleepSession) }); }
    catch (error) { if (!(error instanceof SportsLibDataValidationError)) throw error; }
  });
  const range = nightlyHrvDateRange(valid.map(entry => entry.session));
  if (!range) return [...documents];
  const records: NightlyHrvRecord[] = [];
  let cursor: unknown;
  while (true) {
    const limit = Math.min(NIGHTLY_HRV_LIMITS.pageSize, NIGHTLY_HRV_LIMITS.records - records.length + 1);
    const page = await fetchPage(uid, range.startDate, range.endDate, limit, cursor);
    if (page.records.length > limit) throw new Error('Invalid nightly HRV page.');
    records.push(...page.records);
    assertNightlyHrvRecordBudget(records);
    if (page.records.length < limit) break;
    if (!page.cursor || page.cursor === cursor) throw new Error('Invalid nightly HRV cursor.');
    cursor = page.cursor;
  }
  const enriched = await enrichSleepWithNightlyHrv(uid, valid.map(entry => entry.session), records);
  const result = [...documents];
  valid.forEach((entry, index) => { result[entry.index] = { id: documents[entry.index].id, data: enriched[index] as unknown as Record<string, unknown> }; });
  return result;
}
