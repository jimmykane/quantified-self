type CompletedActivity = { processed?: unknown; resultStatus?: unknown; skippedReason?: unknown };

/** Re-run verified provider copies through the ordinary writer to check the saved workout again. */
export function isReimportableCompletedActivity(existing: CompletedActivity): boolean {
  return existing.processed === true && (
    (!existing.skippedReason && (!existing.resultStatus || existing.resultStatus === 'success'))
    || (existing.resultStatus === 'skipped' && existing.skippedReason === 'cross_provider_duplicate')
  );
}

/** Preserve in-flight work; explicit manual imports may refetch completed recordings once per run. */
export function replacesSupersededHistoryWork(
  existing: { connectionHistoryRunId?: unknown; firebaseUserID?: unknown; processed?: unknown; resultStatus?: unknown; skippedReason?: unknown },
  incoming: { connectionHistoryRunId?: string; firebaseUserID?: string; reimportCompletedActivities?: boolean },
): boolean {
  if (!incoming.connectionHistoryRunId || !incoming.firebaseUserID
    || existing.connectionHistoryRunId === incoming.connectionHistoryRunId
    || existing.firebaseUserID !== incoming.firebaseUserID) return false;
  if (incoming.reimportCompletedActivities && isReimportableCompletedActivity(existing)) return true;
  return typeof existing.connectionHistoryRunId === 'string'
    && (existing.processed !== true || !!existing.skippedReason || (!!existing.resultStatus && existing.resultStatus !== 'success'));
}
