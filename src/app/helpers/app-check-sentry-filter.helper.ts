import type { ErrorEvent, EventHint } from '@sentry/browser';

/** Keep diagnostic scrubbing out of public startup and leave unrelated errors synchronous. */
export function appCheckBeforeSend(event: ErrorEvent, hint?: EventHint): ErrorEvent | null | Promise<ErrorEvent | null> {
  if (event.message !== 'App Check verification failed' && event.message !== 'App Check verification outcome') return event;
  return import('./app-check-sentry-event.helper')
    .then(module => module.appCheckBeforeSend(event, hint))
    .catch(() => null); // Never send an unchecked diagnostic if its sanitizer cannot load.
}
