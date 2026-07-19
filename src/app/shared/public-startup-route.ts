/**
 * Routes that present public content instead of an authenticated workspace.
 * The shell uses this registry to keep public content visible while browser
 * authentication resolves.
 */
const PUBLIC_CONTENT_PATHS = new Set([
  '/',
  '/pricing',
  '/help',
  '/releases',
  '/policies',
  '/tools',
  '/tools/compare',
  '/tools/compare/saved',
  '/integrations',
  '/integrations/garmin',
  '/integrations/suunto',
  '/integrations/coros',
  '/features',
  '/features/workout-data-comparison',
  '/features/training-analysis',
  '/features/ai-insights',
  '/features/workout-file-comparison',
  '/features/fit-gpx-tcx-file-analyzer',
  '/features/fit-gpx-route-files',
  '/features/sports-watch-benchmark',
  '/guides',
  '/guides/sync-garmin-to-suunto',
  '/guides/sync-coros-to-suunto',
  '/guides/sync-suunto-routes-to-garmin-courses',
  '/guides/centralize-garmin-suunto-coros-workout-data',
]);

const AUTH_SENSITIVE_PUBLIC_STARTUP_PATHS = new Set([
  '/tools/compare',
  '/tools/compare/saved',
]);

const PUBLIC_STARTUP_PREFIXES = [
  '/share/event/',
  '/share/comparison/',
] as const;

export function hasAngularServerContext(documentRef: Document | null | undefined): boolean {
  return !!documentRef?.querySelector('app-root[ng-server-context]');
}

/**
 * Google Translate serves pages through `*.translate.goog` and may rewrite text
 * nodes before Angular boots. Hydration requires the client DOM to match the
 * prerendered DOM exactly, so translated proxy documents must client-render.
 */
export function shouldProvideClientHydrationForRuntime(
  documentRef: Document | null | undefined,
  hasBrowserWindow: boolean,
): boolean {
  return !hasBrowserWindow || (!isGoogleTranslateProxyDocument(documentRef) && hasAngularServerContext(documentRef));
}

export function documentRoutePath(documentRef: Document | null | undefined): string {
  const location = documentRef?.location;
  return normalizeRoutePath(location ? `${location.pathname}${location.search}${location.hash}` : '/');
}

export function isPublicStartupPath(path: string): boolean {
  return isPublicContentPath(path);
}

export function isPublicContentPath(path: string): boolean {
  const normalizedPath = normalizeRoutePath(path);
  return PUBLIC_CONTENT_PATHS.has(normalizedPath)
    || PUBLIC_STARTUP_PREFIXES.some(prefix => normalizedPath.startsWith(prefix));
}

export function isPublicStartupDocument(documentRef: Document | null | undefined): boolean {
  return isPublicStartupPath(documentRoutePath(documentRef));
}

export function isRouteLoaderSuppressedStartupPath(path: string): boolean {
  return PUBLIC_CONTENT_PATHS.has(normalizeRoutePath(path));
}

export function isRouteLoaderSuppressedStartupDocument(documentRef: Document | null | undefined): boolean {
  return isRouteLoaderSuppressedStartupPath(documentRoutePath(documentRef));
}

export function isAuthSensitivePublicStartupPath(path: string): boolean {
  return AUTH_SENSITIVE_PUBLIC_STARTUP_PATHS.has(normalizeRoutePath(path));
}

export function isAuthSensitivePublicStartupDocument(documentRef: Document | null | undefined): boolean {
  return isAuthSensitivePublicStartupPath(documentRoutePath(documentRef));
}

export function isSameDocumentRoutePath(documentRef: Document | null | undefined, nextUrl: string): boolean {
  return documentRoutePath(documentRef) === normalizeRoutePath(nextUrl, documentRef);
}

function normalizeRoutePath(rawUrl: string, documentRef?: Document | null): string {
  const baseUrl = resolveBaseUrl(documentRef);

  try {
    const parsedUrl = new URL(rawUrl || '/', baseUrl);
    return normalizePathname(parsedUrl.pathname);
  } catch {
    return normalizePathname((rawUrl || '/').split(/[?#]/, 1)[0] || '/');
  }
}

function resolveBaseUrl(documentRef?: Document | null): string {
  const origin = documentRef?.location?.origin;
  return origin && origin !== 'null' ? origin : 'http://localhost';
}

function isGoogleTranslateProxyDocument(documentRef: Document | null | undefined): boolean {
  const hostname = documentRef?.location?.hostname?.toLowerCase();
  return hostname === 'translate.goog' || !!hostname?.endsWith('.translate.goog');
}

function normalizePathname(pathname: string): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
}
