import { AppCheckFailureDetails, initialAppCheckRejectionFromLog } from './app-check-error.helper';

const observers = new Set<(details: AppCheckFailureDetails) => void>();
const APP_CHECK_CONSOLE_PREFIX = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] {2}@firebase\/app-check:$/;

export function observeInitialAppCheckRejections(observer: (details: AppCheckFailureDetails) => void): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

/** Inspect warnings Sentry already observes; never install a global Firebase log handler. */
export function appCheckBeforeBreadcrumb<T extends { category?: string; level?: string }>(
  breadcrumb: T,
  hint?: { input?: unknown },
): T {
  if (breadcrumb.category !== 'console' || breadcrumb.level !== 'warning') return breadcrumb;
  const input = hint?.input;
  if (!Array.isArray(input) || input.length !== 2
    || typeof input[0] !== 'string' || !APP_CHECK_CONSOLE_PREFIX.test(input[0])) return breadcrumb;
  const details = initialAppCheckRejectionFromLog(input[1]);
  if (!details) return breadcrumb;
  for (const observer of observers) {
    try { observer(details); } catch { /* Diagnostics cannot break console logging or breadcrumb capture. */ }
  }
  return breadcrumb;
}
