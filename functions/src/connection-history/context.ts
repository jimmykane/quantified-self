import { AsyncLocalStorage } from 'node:async_hooks';
import type { firestore } from 'firebase-admin';
import type { HistoryExecution } from './execution';

// One invocation-local guard reaches the existing provider HTTP and canonical
// writers without copying those workers or putting privileged guards in payloads.
const executions = new AsyncLocalStorage<HistoryExecution>();
export const currentHistoryExecution = (): HistoryExecution | undefined => executions.getStore();
export function withHistoryExecution<T>(execution: HistoryExecution, operation: () => Promise<T>): Promise<T> {
  return executions.run(execution, operation);
}
export async function assertHistoryWrite(transaction: firestore.Transaction): Promise<void> {
  await currentHistoryExecution()?.inTransaction(transaction);
}
