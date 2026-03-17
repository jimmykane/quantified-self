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

  it('returns null for auth handler paths', () => {
    const redirectUrl = getFirebaseHostingAliasRedirectUrl({
      localhost: false,
      appUrl: 'https://beta.quantified-self.io',
      locationRef: buildLocationRef({
        pathname: '/__/auth/action'
      })
    });

    expect(redirectUrl).toBeNull();
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
    redirectFromFirebaseHostingAlias(false, 'https://beta.quantified-self.io', locationRef);
    expect(locationRef.replace).toHaveBeenCalledWith('https://beta.quantified-self.io/dashboard?a=1#section');

    const canonicalLocationRef = buildLocationRef({
      hostname: 'beta.quantified-self.io',
      origin: 'https://beta.quantified-self.io'
    });
    redirectFromFirebaseHostingAlias(false, 'https://beta.quantified-self.io', canonicalLocationRef);
    expect(canonicalLocationRef.replace).not.toHaveBeenCalled();
  });
});
