import { logger, type Log } from '@sentry/browser';
import { logPushRemoval, PUSH_REMOVAL_LOG, type PushRemovalEvent } from '@shared/web-push';

export function logBrowserPushRemoval(event: PushRemovalEvent): Promise<void> {
  return logPushRemoval(logger.info, event);
}

/** The SDK attaches the current user's ID and email. Export only the explicit diagnostic fields. */
export function filterPushRemovalLog(log: Log): Log | null {
  if (log.message !== PUSH_REMOVAL_LOG) return null;
  const attributes = Object.fromEntries(Object.entries(log.attributes ?? {}).filter(([key]) =>
    ['reason', 'action', 'origin', 'browser', 'platform', 'accountRef', 'deviceRef', 'sentry.release', 'sentry.environment'].includes(key)));
  return { ...log, attributes };
}
