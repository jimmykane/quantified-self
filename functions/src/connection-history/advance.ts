import { getCloudTaskRetryBackoffSeconds, PROVIDER_MAX_RETRY_COUNT } from '../shared/queue-config';
import { MAX_ISOLATED_HISTORY_FAILURES, MAX_HISTORY_ADMISSION_CHILDREN, MAX_OUTSTANDING_HISTORY_CHILDREN,
  allowsPendingActivityHistory, historyOperationKey, type ConnectionHistoryRun, type HistoryStep } from './model';

export type HistoryChildObservation = 'pending' | 'processed' | 'unavailable' | 'failed' | 'skipped' | 'authorization' | 'mixed'
  | { failedPaths: string[]; hadUnavailableRoutes?: boolean; pendingPaths?: string[]; retryingCount?: number };

export interface HistoryAdvanceDependencies {
  execute(step: HistoryStep): Promise<{ count: number; nextStartMs: number; nextPage: number; routeAfterId?: string; childPaths: string[] }>;
  observe(paths: string[], allowPending?: boolean): Promise<HistoryChildObservation>;
  classify(error: unknown): { kind: 'split' | 'skip' | 'retry' | 'wait'; message: string; nextAllowedAtMs?: number; retryAt?: number };
}
function finishHistoryStep(step: HistoryStep): void {
  step.done = true;
  if (step.failedChildPaths?.length) {
    step.status = 'failed';
    step.message = `History scan finished. ${step.failedChildPaths.length} record${step.failedChildPaths.length === 1 ? '' : 's'} failed. Retry failed imports to recover only those records.`;
  } else {
    step.status = step.capability.completion === 'requested' ? 'requested' : 'processed';
    delete step.message;
  }
}
export function retainedFailureCount(run: ConnectionHistoryRun, additionalPaths: string[] = []): number {
  return new Set([...run.steps.flatMap(step => [...(step.failedChildPaths ?? []),
    ...(step.done && step.status === 'failed' ? step.childPaths : [])]), ...additionalPaths]).size;
}
/** One bounded unit, independently testable from Firebase and provider adapters. */
export async function advanceHistoryRun(run: ConnectionHistoryRun, deps: HistoryAdvanceDependencies, now: number): Promise<void> {
  const step = run.steps.find(x => !x.done);
  if (!step) { run.processed = true; return; }
  const independentActivities = allowsPendingActivityHistory(step);
  let retryingChildren = 0;
  const pendingMessage = (atCapacity = false) => {
    const retrying = Math.min(retryingChildren, step.childPaths.length);
    const processing = step.childPaths.length - retrying;
    const counts = [retrying ? `${retrying} waiting to retry` : '', processing ? `${processing} queued or processing` : '',
      step.failedChildPaths?.length ? `${step.failedChildPaths.length} failed` : ''].filter(Boolean).join(' · ');
    return `${step.nextStartMs > run.endMs ? 'History scan finished.'
      : atCapacity ? 'Waiting for processing capacity.' : 'Continuing the remaining history.'} Workouts: ${counts}.`;
  };
  try {
    if (step.childPaths.length) {
      let observed = independentActivities ? await deps.observe(step.childPaths, true) : await deps.observe(step.childPaths);
      let failureLimitReached = false;
      let pendingPaths: string[] = [];
      if (typeof observed === 'object') {
        const failedPaths = [...new Set([...(step.failedChildPaths ?? []), ...observed.failedPaths])];
        if (retainedFailureCount(run, failedPaths) > MAX_ISOLATED_HISTORY_FAILURES) {
          // Do not announce a finished import while other admitted jobs still run.
          // Keep the bounded original checkpoint until it can be offered for recovery.
          if (independentActivities && observed.pendingPaths?.length) {
            step.status = 'queued';
            step.message = `History admission paused after many failed records. Waiting for ${observed.pendingPaths.length} outstanding workouts before recovery.`;
            run.nextAttemptAt = now + 60_000; run.updatedAtMs = now;
            return;
          }
          // Keep this entire active batch reachable for Retry instead of growing the checkpoint without a bound.
          observed = 'failed'; failureLimitReached = true;
        } else {
          step.failedChildPaths = failedPaths;
          if (observed.hadUnavailableRoutes) step.hadUnavailableRoutes = true;
          pendingPaths = independentActivities ? [...new Set(observed.pendingPaths ?? [])] : [];
          retryingChildren = observed.retryingCount ?? 0;
        }
      }
      if (observed === 'pending') { run.nextAttemptAt = now + 60_000; return; }
      if (observed === 'unavailable' && step.resources.includes('routes')) step.hadUnavailableRoutes = true;
      if (observed === 'failed' || observed === 'mixed') {
        // Child workers already exhausted their retry policy. Offer the owner a
        // retry immediately instead of spending another full parent retry cycle.
        step.status = 'failed'; step.message = observed === 'mixed'
          ? 'Some background imports failed and another needs authorization. Retry unfinished work or reconnect.'
          : failureLimitReached ? 'History paused after many failed records. Retry failed imports to recover them and continue the remaining history.'
            : 'Some background imports failed. Retry failed imports to resume unfinished work.'; step.done = true;
        run.nextAttemptAt = now + 2_000; run.processed = run.steps.every(x => x.done); run.updatedAtMs = now;
        return;
      }
      if (observed === 'authorization') {
        step.status = 'skipped'; step.message = 'Permission is missing or authorization expired. Reconnect to enable this history.'; step.done = true;
      }
      if (observed === 'skipped') {
        step.status = 'skipped'; step.message = 'Some records were unavailable or the connection changed.'; step.done = true;
      }
      // A stopped batch stays part of recovery when earlier failures make this scope retryable.
      if (!step.done || !step.failedChildPaths?.length) step.childPaths = pendingPaths;
    }
    // Reserve room for one unchanged provider batch. Settled children leave the
    // checkpoint; outstanding jobs retain their exact identities and retry clocks.
    if (!step.done && independentActivities && step.childPaths.length
      && run.lastOperation?.key !== historyOperationKey(step)
      && (step.nextStartMs > run.endMs
        || step.childPaths.length + retainedFailureCount(run) > MAX_OUTSTANDING_HISTORY_CHILDREN - MAX_HISTORY_ADMISSION_CHILDREN
        || retainedFailureCount(run) >= MAX_ISOLATED_HISTORY_FAILURES)) {
      step.status = step.nextStartMs > run.endMs && retryingChildren === step.childPaths.length ? 'retrying' : 'queued';
      step.message = pendingMessage(true);
      run.nextAttemptAt = now + 60_000; run.updatedAtMs = now;
      return;
    }
    if (!step.done && step.nextStartMs > run.endMs && !step.childPaths.length) {
      finishHistoryStep(step);
    }
    if (!step.done && retainedFailureCount(run) >= MAX_ISOLATED_HISTORY_FAILURES
      && run.lastOperation?.key !== historyOperationKey(step)) {
      step.done = true; step.status = 'failed';
      step.message = 'History paused after many failed records. Retry failed imports to recover them and continue the remaining history.';
    }
    if (!step.done) {
      step.status = 'requesting';
      const result = await deps.execute(step);
      step.count += result.count; step.nextStartMs = result.nextStartMs; step.page = result.nextPage;
      if (result.routeAfterId !== undefined) step.routeAfterId = result.routeAfterId;
      step.retryCount = 0; delete step.message;
      step.childPaths = [...new Set([...step.childPaths, ...result.childPaths])];
      if (step.nextStartMs > run.endMs && !step.childPaths.length) {
        finishHistoryStep(step);
      } else step.status = 'queued';
      if (independentActivities && step.childPaths.length) step.message = pendingMessage();
    }
    run.nextAttemptAt = now + (step.childPaths.length ? 60_000 : 2_000);
  } catch (error) {
    const failure = deps.classify(error);
    step.message = failure.message;
    if (failure.kind === 'wait') {
      step.status = 'queued'; run.nextAttemptAt = now + 60_000;
    } else if (failure.kind === 'split' && (step.windowDays ?? 30) > 1) {
      step.windowDays = Math.max(1, Math.floor((step.windowDays ?? 30) / 2));
      step.status = 'retrying'; run.nextAttemptAt = now + 2_000;
    } else if (failure.kind === 'skip') {
      step.status = 'skipped'; step.done = true;
      if (failure.nextAllowedAtMs) step.nextAllowedAtMs = failure.nextAllowedAtMs;
      run.nextAttemptAt = now + 2_000;
    } else {
      step.retryCount++;
      step.done = failure.kind === 'split' || step.retryCount >= PROVIDER_MAX_RETRY_COUNT;
      step.status = step.done ? 'failed' : 'retrying';
      run.nextAttemptAt = step.done ? now + 2_000 : Math.max(failure.retryAt || 0, now + getCloudTaskRetryBackoffSeconds(step.retryCount) * 1000);
    }
  }
  if (step.failedChildPaths?.length) {
    if (step.done && step.status === 'skipped') {
      step.status = 'failed';
      step.message += ` ${step.failedChildPaths.length} earlier records also failed. Retry failed imports after resolving this issue.`;
    } else if (!step.done && !step.message) {
      step.message = `${step.failedChildPaths.length} record${step.failedChildPaths.length === 1 ? '' : 's'} failed. Continuing the remaining history.`;
    }
  }
  if (step.hadUnavailableRoutes && (step.status === 'queued' && !step.message || step.status === 'processed')) {
    step.message = 'Some routes were no longer available and were skipped.';
  }
  run.processed = run.steps.every(x => x.done);
  run.updatedAtMs = now;
}
