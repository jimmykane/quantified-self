import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { Auth as FirebaseAuth, User as FirebaseUser } from 'firebase/auth';
import { onAuthStateChanged, onIdTokenChanged } from 'firebase/auth';
import { Observable } from 'rxjs';
import { FirebaseApp } from './app';

export * from 'firebase/auth';

export const Auth = new InjectionToken<FirebaseAuth>('FirebaseAuth');

export function provideAuth(factory: () => FirebaseAuth): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: Auth,
      useFactory: (_firebaseApp: unknown) => factory(),
      deps: [FirebaseApp]
    }
  ]);
}

export function authState(auth: FirebaseAuth): Observable<FirebaseUser | null> {
  return new Observable<FirebaseUser | null>((subscriber) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (value) => subscriber.next(value),
      (error) => subscriber.error(error)
    );
    return unsubscribe;
  });
}

export function user(auth: FirebaseAuth): Observable<FirebaseUser | null> {
  return new Observable<FirebaseUser | null>((subscriber) => {
    const unsubscribe = onIdTokenChanged(
      auth,
      (value) => subscriber.next(value),
      (error) => subscriber.error(error)
    );
    return unsubscribe;
  });
}
