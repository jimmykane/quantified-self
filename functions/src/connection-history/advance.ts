import { getCloudTaskRetryBackoffSeconds, MAX_RETRY_COUNT } from '../shared/queue-config';
import type { ConnectionHistoryRun, HistoryStep } from './model';

export interface HistoryAdvanceDependencies {
  execute(step: HistoryStep): Promise<{ count: number; nextStartMs: number; nextPage: number; childPaths: string[] }>;
  observe(paths: string[]): Promise<'pending' | 'processed' | 'failed' | 'skipped' | 'authorization' | 'mixed'>;
  classify(error: unknown): { kind: 'split' | 'skip' | 'retry' | 'wait'; message: string; nextAllowedAtMs?: number; retryAt?: number };
}
/** One bounded unit, independently testable from Firebase and provider adapters. */
export async function advanceHistoryRun(run: ConnectionHistoryRun, deps: HistoryAdvanceDependencies, now: number): Promise<void> {
  const step = run.steps.find(x => !x.done);
  if (!step) { run.processed = true; return; }
  try {
    if (step.childPaths.length) {
      const observed = await deps.observe(step.childPaths);
      if (observed === 'pending') { run.nextAttemptAt = now + 60_000; return; }
      if (observed === 'failed' || observed === 'mixed') {
        // Child workers already exhausted their retry policy. Offer the owner a
        // retry immediately instead of spending another full parent retry cycle.
        step.status = 'failed'; step.message = observed === 'mixed'
          ? 'Some background imports failed and another needs authorization. Retry unfinished work or reconnect.'
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
      step.childPaths = [];
    }
    if (!step.done && step.nextStartMs > run.endMs) {
      step.status = step.capability.completion === 'requested' ? 'requested' : 'processed'; step.done = true;
    }
    if (!step.done) {
      step.status = 'requesting';
      const result = await deps.execute(step);
      step.count += result.count; step.nextStartMs = result.nextStartMs; step.page = result.nextPage;
      step.retryCount = 0; delete step.message;
      step.childPaths = result.childPaths;
      if (step.nextStartMs > run.endMs && !step.childPaths.length) {
        step.done = true; step.status = step.capability.completion === 'requested' ? 'requested' : 'processed';
      } else step.status = 'queued';
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
      step.done = failure.kind === 'split' || step.retryCount >= MAX_RETRY_COUNT;
      step.status = step.done ? 'failed' : 'retrying';
      run.nextAttemptAt = step.done ? now + 2_000 : Math.max(failure.retryAt || 0, now + getCloudTaskRetryBackoffSeconds(step.retryCount) * 1000);
    }
  }
  run.processed = run.steps.every(x => x.done);
  run.updatedAtMs = now;
}
