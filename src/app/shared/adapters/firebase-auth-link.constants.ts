export const APP_LOGIN_PATH = '/login';
export const FIREBASE_AUTH_ACTION_PATH_PREFIX = '/__/auth/';
export const FIREBASE_DEFAULT_HOSTING_DOMAIN_SUFFIXES = ['.firebaseapp.com', '.web.app'] as const;

const LOCALHOST_DOMAIN = 'localhost';

export function normalizeUrlOrHost(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/\/+$/, '');
  return normalized.length > 0 ? normalized : null;
}

export function isFirebaseDefaultHostingDomain(hostname: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  return FIREBASE_DEFAULT_HOSTING_DOMAIN_SUFFIXES.some((suffix) => normalizedHost.endsWith(suffix));
}

export function isFirebaseAuthActionPath(pathname: string): boolean {
  return pathname.startsWith(FIREBASE_AUTH_ACTION_PATH_PREFIX);
}

export function canUseCustomAuthLinkDomain(domain: string): boolean {
  const normalized = domain.toLowerCase();
  return normalized !== LOCALHOST_DOMAIN && !isFirebaseDefaultHostingDomain(normalized);
}

export function buildAppUrl(
  baseUrl: string,
  pathname: string,
  options: { preferHttpsForLocalhost?: boolean } = {}
): string {
  const parsedBaseUrl = new URL(baseUrl);

  if (options.preferHttpsForLocalhost && parsedBaseUrl.hostname.toLowerCase() === LOCALHOST_DOMAIN) {
    parsedBaseUrl.protocol = 'https:';
  }

  const normalizedPathname = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const resolvedBaseUrl = parsedBaseUrl.toString();
  const baseWithTrailingSlash = resolvedBaseUrl.endsWith('/') ? resolvedBaseUrl : `${resolvedBaseUrl}/`;

  return new URL(normalizedPathname, baseWithTrailingSlash).toString();
}
