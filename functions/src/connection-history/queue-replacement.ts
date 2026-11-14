/** Preserve in-flight work; explicit manual imports may refetch completed recordings once per run. */
export function replacesSupersededHistoryWork(
  existing: { connectionHistoryRunId?: unknown; firebaseUserID?: unknown; processed?: unknown; resultStatus?: unknown; skippedReason?: unknown },
  incoming: { connectionHistoryRunId?: string; firebaseUserID?: string; reimportCompletedActivities?: boolean },
): boolean {
  if (!incoming.connectionHistoryRunId || !incoming.firebaseUserID
    || existing.connectionHistoryRunId === incoming.connectionHistoryRunId
    || existing.firebaseUserID !== incoming.firebaseUserID) return false;
  if (incoming.reimportCompletedActivities && existing.processed === true
    && !existing.skippedReason && (!existing.resultStatus || existing.resultStatus === 'success')) return true;
  return typeof existing.connectionHistoryRunId === 'string'
    && (existing.processed !== true || !!existing.skippedReason || (!!existing.resultStatus && existing.resultStatus !== 'success'));
}
