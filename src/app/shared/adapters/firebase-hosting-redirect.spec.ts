import { describe, expect, it, vi } from 'vitest';
import {
  getFirebaseHostingAliasRedirectUrl,
  redirectFromFirebaseHostingAlias,
  type RedirectLocationRef
} from './firebase-hosting-redirect';

function buildLocationRef(overrides: Partial<RedirectLocationRef> = {}): RedirectLocationRef {
  return {
    hostname: 'quantified-self-io.firebaseapp.com',
    pathname: '/dashboard',
    search: '?a=1',
    hash: '#section',
    origin: 'https://quantified-self-io.firebaseapp.com',
    replace: vi.fn(),
    ...overrides
  };
}

describe('firebase-hosting-redirect', () => {
  it('builds a canonical redirect URL for firebaseapp aliases', () => {
    const redirectUrl = getFirebaseHostingAliasRedirectUrl({
      localhost: false,
      appUrl: 'https://beta.quantified-self.io',
      locationRef: buildLocationRef()
    });

    expect(redirectUrl).toBe('https://beta.quantified-self.io/dashboard?a=1#section');
  });

  it('builds a canonical redirect URL for web.app aliases', () => {
    const redirectUrl = getFirebaseHostingAliasRedirectUrl({
      localhost: false,
      appUrl: 'https://beta.quantified-self.io',
      locationRef: buildLocationRef({
        hostname: 'quantified-self-io.web.app',
        origin: 'https://quantified-self-io.web.app'
      })
    });

    expect(redirectUrl).toBe('https://beta.quantified-self.io/dashboard?a=1#section');
  });

  it.each(['/__/auth/action', '/__/auth/handler', '/__/auth/iframe'])('leaves the auth path %s untouched', pathname => {
    const locationRef = buildLocationRef({ pathname });
    const redirectUrl = getFirebaseHostingAliasRedirectUrl({
      localhost: false,
      appUrl: 'https://beta.quantified-self.io',
      locationRef
    });

    expect(redirectUrl).toBeNull();
    expect(redirectFromFirebaseHostingAlias(false, 'https://beta.quantified-self.io', locationRef)).toBe(false);
    expect(locationRef.replace).not.toHaveBeenCalled();
  });

  it('returns null for non-firebase aliases', () => {
    const redirectUrl = getFirebaseHostingAliasRedirectUrl({
      localhost: false,
      appUrl: 'https://beta.quantified-self.io',
      locationRef: buildLocationRef({
        hostname: 'beta.quantified-self.io',
        origin: 'https://beta.quantified-self.io'
      })
    });

    expect(redirectUrl).toBeNull();
  });

  it('redirect helper calls replace only when needed', () => {
    const locationRef = buildLocationRef();
    expect(redirectFromFirebaseHostingAlias(false, 'https://beta.quantified-self.io', locationRef)).toBe(true);
    expect(locationRef.replace).toHaveBeenCalledWith('https://beta.quantified-self.io/dashboard?a=1#section');

    const canonicalLocationRef = buildLocationRef({
      hostname: 'beta.quantified-self.io',
      origin: 'https://beta.quantified-self.io'
    });
    expect(redirectFromFirebaseHostingAlias(false, 'https://beta.quantified-self.io', canonicalLocationRef)).toBe(false);
    expect(canonicalLocationRef.replace).not.toHaveBeenCalled();
  });

  it('preserves email sign-in parameters and the fragment when redirecting an app page', () => {
    const locationRef = buildLocationRef({
      pathname: '/login',
      search: '?mode=signIn&oobCode=synthetic-code&continueUrl=https%3A%2F%2Fquantified-self.io%2Flogin',
      hash: '#sign-in'
    });

    expect(redirectFromFirebaseHostingAlias(false, 'https://quantified-self.io', locationRef)).toBe(true);
    expect(locationRef.replace).toHaveBeenCalledExactlyOnceWith(
      `https://quantified-self.io/login${locationRef.search}${locationRef.hash}`
    );
  });

  it('does not redirect localhost builds', () => {
    const locationRef = buildLocationRef();

    expect(redirectFromFirebaseHostingAlias(true, 'http://localhost:4200', locationRef)).toBe(false);
    expect(locationRef.replace).not.toHaveBeenCalled();
  });
});
