const PUBLIC_STARTUP_PATHS = new Set([
  '/',
  '/pricing',
  '/help',
  '/releases',
  '/tools',
  '/tools/compare',
  '/tools/compare/saved',
  '/integrations',
  '/integrations/garmin',
  '/integrations/suunto',
  '/integrations/coros',
  '/features',
  '/features/workout-data-comparison',
  '/features/ai-insights',
  '/features/workout-file-comparison',
  '/features/fit-gpx-tcx-file-analyzer',
  '/features/sports-watch-benchmark',
  '/guides',
  '/guides/sync-garmin-to-suunto',
  '/guides/sync-coros-to-suunto',
  '/guides/centralize-garmin-suunto-coros-workout-data',
]);

export function hasAngularServerContext(documentRef: Document | null | undefined): boolean {
  return !!documentRef?.querySelector('app-root[ng-server-context]');
}

export function shouldProvideClientHydrationForRuntime(
  documentRef: Document | null | undefined,
  hasBrowserWindow: boolean,
): boolean {
  return !hasBrowserWindow || hasAngularServerContext(documentRef);
}

export function documentRoutePath(documentRef: Document | null | undefined): string {
  const location = documentRef?.location;
  return normalizeRoutePath(location ? `${location.pathname}${location.search}${location.hash}` : '/');
}

export function isPublicStartupPath(path: string): boolean {
  return PUBLIC_STARTUP_PATHS.has(normalizeRoutePath(path));
}

export function isPublicStartupDocument(documentRef: Document | null | undefined): boolean {
  return isPublicStartupPath(documentRoutePath(documentRef));
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

function normalizePathname(pathname: string): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
}
