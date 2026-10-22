import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/browser';
import { appCheckFailureDetails } from './app-check-error.helper';

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max = 256): string | undefined => typeof value === 'string' ? value.slice(0, max) : undefined;
const number = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
const boolean = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;
const choice = <T extends string>(value: unknown, values: readonly T[]): T | undefined =>
  values.find(candidate => candidate === value);
const method = (value: unknown): string | undefined => choice(value, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** Keep the endpoint/page path, without query credentials, fragments or URL userinfo. No requests are made. */
function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096 || !/^(https?:\/\/|\/)/i.test(value)) return undefined;
  try {
    const url = new URL(value, 'https://relative.invalid');
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return value.startsWith('/') && !value.startsWith('//') ? url.pathname : `${url.origin}${url.pathname}`;
  } catch { return undefined; }
}

function safeBreadcrumb(crumb: Breadcrumb): Breadcrumb | undefined {
  const timestamp = number(crumb.timestamp, 0, Number.MAX_SAFE_INTEGER);
  const level = choice(crumb.level, ['fatal', 'error', 'warning', 'log', 'info', 'debug']);
  const data = record(crumb.data);
  if (crumb.category === 'navigation') return { category: 'navigation', type: 'navigation', timestamp, level,
    data: { from: safeUrl(data['from']), to: safeUrl(data['to']) } };
  if (crumb.category === 'fetch' || crumb.category === 'xhr' || crumb.category === 'http') {
    return { category: crumb.category, type: 'http', timestamp, level,
      data: { url: safeUrl(data['url']), method: method(data['method'] ?? data['http.method']),
        status_code: number(data['status_code'], 100, 599) } };
  }
  // Keep the sequence/severity of actions and console warnings, never their arbitrary text or arguments.
  if (crumb.category === 'console' || crumb.category === 'ui.click') return { category: crumb.category, timestamp, level };
  return undefined;
}

/** Limit only App Check diagnostic envelopes; other Sentry errors retain their existing behavior. */
export function appCheckBeforeSend(event: ErrorEvent, hint?: EventHint): ErrorEvent | null {
  if (event.message !== 'App Check verification failed' && event.message !== 'App Check verification outcome') return event;
  try {
    // Attachments are held on the SDK hint, outside the event returned by beforeSend.
    if (hint) hint.attachments = [];
    const raw = record(event.contexts?.['appCheck']);
    const code = appCheckFailureDetails({ code: raw['code'] })?.code ?? 'appCheck/unknown';
    const authState = choice(raw['authState'], ['restoring', 'signed-in', 'signed-out']);
    const operation = choice(raw['operation'], ['profile-load', 'callable']);
    const outcome = choice(raw['outcome'], ['token-available', 'operation-blocked', 'operation-succeeded']);
    const httpStatus = number(raw['httpStatus'], 400, 599) ?? null;
    const phase = choice(event.tags?.['appCheckPhase'], ['initial-rejection', 'cooldown', 'verification']) ?? 'verification';
    const failure = event.message === 'App Check verification failed';
    const appCheck = {
      code, httpStatus, authState,
      authStateAtFailure: choice(raw['authStateAtFailure'], ['restoring', 'signed-in', 'signed-out']),
      retryAfterSeconds: number(raw['retryAfterSeconds'], 0, 86_400) ?? null,
      cooldown: boolean(raw['cooldown']), retryable: boolean(raw['retryable']),
      elapsedMs: number(raw['elapsedMs'], 0, 86_400_000),
      failureNotifications: number(raw['failureNotifications'], 1, 1000),
      source: choice(raw['source'], ['console-breadcrumb', 'token-observer', 'token-request']),
      online: raw['online'] === null ? null : boolean(raw['online']),
      visibility: choice(raw['visibility'], ['visible', 'hidden', 'unknown']),
      outcome, operation, tokenChanged: raw['tokenChanged'] === null ? null : boolean(raw['tokenChanged']),
    };
    const headers = record(event.request?.headers);
    const userAgent = Object.entries(headers).find(([key]) => key.toLowerCase() === 'user-agent')?.[1];
    const referer = Object.entries(headers).find(([key]) => key.toLowerCase() === 'referer')?.[1];
    const requestHeaders: Record<string, string> = {};
    if (typeof userAgent === 'string') requestHeaders['User-Agent'] = userAgent.slice(0, 512);
    const safeReferer = safeUrl(referer);
    if (safeReferer) requestHeaders['Referer'] = safeReferer;
    const trace = record(event.contexts?.trace);
    const traceId = typeof trace['trace_id'] === 'string' && /^[a-f\d]{32}$/i.test(trace['trace_id']) ? trace['trace_id'] : undefined;
    const spanId = typeof trace['span_id'] === 'string' && /^[a-f\d]{16}$/i.test(trace['span_id']) ? trace['span_id'] : undefined;
    return {
      type: undefined,
      event_id: event.event_id, timestamp: event.timestamp, platform: event.platform,
      environment: event.environment, release: event.release, dist: event.dist, sdk: event.sdk,
      message: event.message, level: event.level,
      user: event.user ? { id: text(event.user.id, 128), email: text(event.user.email, 254) } : undefined,
      request: event.request ? { url: safeUrl(event.request.url), method: method(event.request.method), headers: requestHeaders } : undefined,
      contexts: { appCheck, ...(traceId && spanId ? { trace: { trace_id: traceId, span_id: spanId } } : {}) },
      tags: { appCheckErrorCode: code, appCheckAuthState: authState,
        ...(failure ? { appCheckPhase: phase, appCheckHttpStatus: String(httpStatus ?? 'unknown') }
          : { appCheckOutcome: outcome, ...(operation ? { appCheckOperation: operation } : {}) }) },
      fingerprint: failure ? ['app-check-verification', phase, String(httpStatus ?? 'unknown')]
        : ['app-check-outcome', outcome ?? 'unknown', operation ?? 'verification', code],
      breadcrumbs: event.breadcrumbs?.map(safeBreadcrumb).filter((crumb): crumb is Breadcrumb => !!crumb),
    };
  } catch { return null; /* Drop a malformed diagnostic rather than send unchecked context. */ }
}
