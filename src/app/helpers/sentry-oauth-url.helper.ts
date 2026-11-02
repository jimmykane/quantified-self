import type { Breadcrumb, Event } from '@sentry/browser';

function parameterName(key: string): string {
  try { return decodeURIComponent(key).toLowerCase(); } catch { return ''; }
}

const isOAuthParameter = (key: string): boolean => /^(code|state)$/.test(parameterName(key));

const PARAMETERS = /(^|[?&#])([^?&#=]+)=([^&#]*)/g;

function scrubParameterValue(key: string, value: string): string {
  if (isOAuthParameter(key)) return '[Filtered]';
  // The login guard can carry the OAuth callback as an encoded returnUrl.
  if (parameterName(key) !== 'returnurl') return value;
  try {
    const decoded = decodeURIComponent(value);
    const clean = decoded.replace(PARAMETERS, (match, separator: string, name: string) =>
      isOAuthParameter(name) ? `${separator}${name}=[Filtered]` : match);
    return clean === decoded ? value : decoded === value ? clean : encodeURIComponent(clean);
  } catch { return '[Filtered]'; }
}

/** Redact telemetry copies only; preserve paths and unrelated query/fragment parameters. */
export function scrubSentryOAuthUrl(value: string): string {
  return value.replace(PARAMETERS, (_match, separator: string, key: string, parameterValue: string) =>
    `${separator}${key}=${scrubParameterValue(key, parameterValue)}`);
}

function scrubUrlFields<T extends object>(fields: T, keys: readonly string[]): T {
  let clean = fields;
  for (const key of keys) {
    const value = (fields as Record<string, unknown>)[key];
    if (typeof value !== 'string') continue;
    const scrubbed = scrubSentryOAuthUrl(value);
    if (scrubbed !== value) clean = { ...clean, [key]: scrubbed };
  }
  return clean;
}

export function scrubSentryOAuthBreadcrumb<T extends { data?: Breadcrumb['data'] }>(breadcrumb: T): T {
  if (!breadcrumb.data) return breadcrumb;
  const data = scrubUrlFields(breadcrumb.data, ['from', 'to', 'url', 'http.query', 'http.fragment']);
  return data === breadcrumb.data ? breadcrumb : { ...breadcrumb, data };
}

function scrubQuery(query: NonNullable<Event['request']>['query_string']) {
  if (typeof query === 'string') return scrubSentryOAuthUrl(query);
  if (Array.isArray(query)) return query.map(([key, value]): [string, string] =>
    [key, scrubParameterValue(key, value)]);
  if (query) return Object.fromEntries(Object.entries(query).map(([key, value]) =>
    [key, scrubParameterValue(key, value)]));
  return query;
}

const TRACE_URL_FIELDS = ['url', 'http.url', 'http.query', 'http.fragment', 'url.full', 'url.query', 'url.fragment'];

/** Error and transaction envelopes share these SDK URL fields; never walk arbitrary application data. */
export function scrubSentryOAuthEvent<T extends Event>(event: T): T {
  let clean = scrubUrlFields(event, ['transaction']);
  if (event.request) {
    const request = scrubUrlFields(event.request, ['url']);
    clean = { ...clean, request: { ...request,
      ...(request.query_string !== undefined ? { query_string: scrubQuery(request.query_string) } : {}),
      ...(request.headers ? { headers: scrubUrlFields(request.headers,
        Object.keys(request.headers).filter(key => key.toLowerCase() === 'referer')) } : {}),
    } };
  }
  if (event.tags) clean = { ...clean, tags: scrubUrlFields(event.tags, ['url']) };
  if (event.breadcrumbs) clean = { ...clean, breadcrumbs: event.breadcrumbs.map(scrubSentryOAuthBreadcrumb) };
  if (event.exception?.values) clean = { ...clean, exception: { ...event.exception,
    values: event.exception.values.map(value => value.stacktrace?.frames ? { ...value,
      stacktrace: { ...value.stacktrace, frames: value.stacktrace.frames.map(frame =>
        scrubUrlFields(frame, ['filename', 'abs_path'])) },
    } : value),
  } };
  const trace = event.contexts?.trace;
  if (trace?.data) clean = { ...clean, contexts: { ...event.contexts,
    trace: { ...trace, data: scrubUrlFields(trace.data, TRACE_URL_FIELDS) },
  } };
  if (event.spans) clean = { ...clean, spans: event.spans.map(span => ({
    ...scrubUrlFields(span, ['description']), data: scrubUrlFields(span.data, TRACE_URL_FIELDS),
  })) };
  return clean;
}
