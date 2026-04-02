import {
  EnvironmentProviders,
  InjectionToken,
  NgZone,
  inject,
  makeEnvironmentProviders
} from '@angular/core';
import type { Auth as FirebaseAuth, User as FirebaseUser } from 'firebase/auth';
import { onAuthStateChanged, onIdTokenChanged } from 'firebase/auth';
import { Observable } from 'rxjs';
import { FirebaseApp } from './app';

export {
  FacebookAuthProvider,
  GithubAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  TwitterAuthProvider,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  getAuth,
  getIdToken,
  getRedirectResult,
  isSignInWithEmailLink,
  linkWithCredential,
  linkWithPopup,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from 'firebase/auth';
export type {
  AuthCredential,
  AuthProvider,
  User as FirebaseUserType,
  Auth as FirebaseAuthType
} from 'firebase/auth';

export const Auth = new InjectionToken<FirebaseAuth>('FirebaseAuth');

const authZoneRegistry = new WeakMap<FirebaseAuth, NgZone | null>();

function rememberAuthZone(auth: FirebaseAuth, zone: NgZone | null): void {
  authZoneRegistry.set(auth, zone);
}

export function provideAuth(factory: () => FirebaseAuth): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: Auth,
      // `deps` forces FirebaseApp initialization before resolving Auth.
      useFactory: (_firebaseApp: unknown) => {
        const auth = factory();
        rememberAuthZone(auth, inject(NgZone, { optional: true }));
        return auth;
      },
      deps: [FirebaseApp]
    }
  ]);
}

function tryInjectNgZone(): NgZone | null {
  try {
    return inject(NgZone, { optional: true });
  } catch {
    return null;
  }
}

function resolveNgZoneForAuth(auth: FirebaseAuth): NgZone | null {
  return tryInjectNgZone() ?? authZoneRegistry.get(auth) ?? null;
}

function runInAngularZone(zone: NgZone | null, callback: () => void): void {
  if (!zone) {
    callback();
    return;
  }

  // Firebase listener callbacks can run outside Angular's zone.
  zone.run(callback);
}

export function authState(auth: FirebaseAuth): Observable<FirebaseUser | null> {
  const zone = resolveNgZoneForAuth(auth);

  return new Observable<FirebaseUser | null>((subscriber) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (value) => runInAngularZone(zone, () => subscriber.next(value)),
      (error) => runInAngularZone(zone, () => subscriber.error(error))
    );
    return unsubscribe;
  });
}

export function user(auth: FirebaseAuth): Observable<FirebaseUser | null> {
  const zone = resolveNgZoneForAuth(auth);

  return new Observable<FirebaseUser | null>((subscriber) => {
    const unsubscribe = onIdTokenChanged(
      auth,
      (value) => runInAngularZone(zone, () => subscriber.next(value)),
      (error) => runInAngularZone(zone, () => subscriber.error(error))
    );
    return unsubscribe;
  });
}
