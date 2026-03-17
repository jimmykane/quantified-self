import {
  isFirebaseAuthActionPath,
  isFirebaseDefaultHostingDomain
} from './firebase-auth-link.constants';

export interface RedirectLocationRef {
  hostname: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  replace(url: string): void;
}

export interface FirebaseHostingAliasRedirectOptions {
  localhost: boolean;
  appUrl: string;
  locationRef: RedirectLocationRef;
}

/**
 * Keeps users on canonical quantified-self hostnames when they land on Firebase
 * default aliases from external links or direct URL entry.
 */
export function getFirebaseHostingAliasRedirectUrl(
  options: FirebaseHostingAliasRedirectOptions
): string | null {
  if (options.localhost) {
    return null;
  }

  const currentHost = options.locationRef.hostname.toLowerCase();
  if (!isFirebaseDefaultHostingDomain(currentHost)) {
    return null;
  }

  if (isFirebaseAuthActionPath(options.locationRef.pathname)) {
    return null;
  }

  let targetOrigin: string;
  try {
    targetOrigin = new URL(options.appUrl).origin;
  } catch {
    return null;
  }

  if (!targetOrigin || targetOrigin === options.locationRef.origin) {
    return null;
  }

  return `${targetOrigin}${options.locationRef.pathname}${options.locationRef.search}${options.locationRef.hash}`;
}

export function redirectFromFirebaseHostingAlias(
  localhost: boolean,
  appUrl: string,
  locationRef: RedirectLocationRef = window.location
): void {
  const redirectUrl = getFirebaseHostingAliasRedirectUrl({
    localhost,
    appUrl,
    locationRef
  });

  if (!redirectUrl) {
    return;
  }

  locationRef.replace(redirectUrl);
}
