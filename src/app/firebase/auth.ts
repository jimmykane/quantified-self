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

export function provideAuth(factory: () => FirebaseAuth): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: Auth,
      // `deps` forces FirebaseApp initialization before resolving Auth.
      useFactory: (_firebaseApp: unknown) => factory(),
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

function runInAngularZone(zone: NgZone | null, callback: () => void): void {
  if (!zone) {
    callback();
    return;
  }

  // Firebase listener callbacks can run outside Angular's zone.
  zone.run(callback);
}

export function authState(auth: FirebaseAuth): Observable<FirebaseUser | null> {
  const zone = tryInjectNgZone();

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
  const zone = tryInjectNgZone();

  return new Observable<FirebaseUser | null>((subscriber) => {
    const unsubscribe = onIdTokenChanged(
      auth,
      (value) => runInAngularZone(zone, () => subscriber.next(value)),
      (error) => runInAngularZone(zone, () => subscriber.error(error))
    );
    return unsubscribe;
  });
}
