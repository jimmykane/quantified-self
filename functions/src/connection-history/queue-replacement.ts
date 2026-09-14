/** A new connection may replace unfinished work from its own superseded run. */
export function replacesSupersededHistoryWork(
  existing: { connectionHistoryRunId?: unknown; firebaseUserID?: unknown; processed?: unknown; resultStatus?: unknown; skippedReason?: unknown },
  incoming: { connectionHistoryRunId?: string; firebaseUserID?: string },
): boolean {
  return !!incoming.connectionHistoryRunId && !!incoming.firebaseUserID
    && typeof existing.connectionHistoryRunId === 'string'
    && existing.connectionHistoryRunId !== incoming.connectionHistoryRunId
    && existing.firebaseUserID === incoming.firebaseUserID
    && (existing.processed !== true || !!existing.skippedReason || (!!existing.resultStatus && existing.resultStatus !== 'success'));
}
