import { describe, expect, it } from 'vitest';
import {
  buildAppUrl,
  canUseCustomAuthLinkDomain,
  isFirebaseAuthActionPath,
  isFirebaseDefaultHostingDomain,
  normalizeUrlOrHost
} from './firebase-auth-link.constants';

describe('firebase-auth-link.constants', () => {
  it('normalizeUrlOrHost trims whitespace and trailing slashes', () => {
    expect(normalizeUrlOrHost(' https://quantified-self.io/// ')).toBe('https://quantified-self.io');
  });

  it('detects firebase hosting aliases', () => {
    expect(isFirebaseDefaultHostingDomain('quantified-self-io.firebaseapp.com')).toBe(true);
    expect(isFirebaseDefaultHostingDomain('quantified-self.io')).toBe(false);
  });

  it('detects firebase auth action paths', () => {
    expect(isFirebaseAuthActionPath('/__/auth/action')).toBe(true);
    expect(isFirebaseAuthActionPath('/login')).toBe(false);
  });

  it('allows custom auth link domains only for non-localhost custom domains', () => {
    expect(canUseCustomAuthLinkDomain('quantified-self.io')).toBe(true);
    expect(canUseCustomAuthLinkDomain('localhost')).toBe(false);
    expect(canUseCustomAuthLinkDomain('quantified-self-io.web.app')).toBe(false);
  });

  it('builds relative app paths from the configured base URL', () => {
    expect(buildAppUrl('https://quantified-self.io', '/login')).toBe('https://quantified-self.io/login');
    expect(buildAppUrl('https://quantified-self.io/app', '/login')).toBe('https://quantified-self.io/app/login');
  });

  it('forces https for localhost auth action URLs when requested', () => {
    expect(buildAppUrl('http://localhost:4200', '/login', { preferHttpsForLocalhost: true }))
      .toBe('https://localhost:4200/login');
    expect(buildAppUrl('https://beta.quantified-self.io', '/login', { preferHttpsForLocalhost: true }))
      .toBe('https://beta.quantified-self.io/login');
  });
});
