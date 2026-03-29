import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type {
  DocumentData,
  DocumentReference,
  Firestore as FirebaseFirestore,
  Query
} from 'firebase/firestore';
import { onSnapshot } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { FirebaseApp } from './app';

export * from 'firebase/firestore';

export const Firestore = new InjectionToken<FirebaseFirestore>('Firestore');

export interface FirestoreDataOptions {
  idField?: string;
}

export function provideFirestore(factory: () => FirebaseFirestore): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: Firestore,
      useFactory: (_firebaseApp: unknown) => factory(),
      deps: [FirebaseApp]
    }
  ]);
}

function withOptionalID<T>(payload: T, id: string, options?: FirestoreDataOptions): T {
  if (!options?.idField) {
    return payload;
  }

  return {
    ...(payload as Record<string, unknown>),
    [options.idField]: id
  } as T;
}

export function collectionData<T = DocumentData>(
  query: Query<T>,
  options?: FirestoreDataOptions
): Observable<T[]> {
  return new Observable<T[]>((subscriber) => {
    const unsubscribe = onSnapshot(
      query,
      (snapshot) => {
        const values = snapshot.docs.map((documentSnapshot) => {
          return withOptionalID(documentSnapshot.data(), documentSnapshot.id, options);
        });
        subscriber.next(values);
      },
      (error) => subscriber.error(error)
    );

    return unsubscribe;
  });
}

export function docData<T = DocumentData>(
  reference: DocumentReference<T>,
  options?: FirestoreDataOptions
): Observable<T | undefined> {
  return new Observable<T | undefined>((subscriber) => {
    const unsubscribe = onSnapshot(
      reference,
      (snapshot) => {
        if (!snapshot.exists()) {
          subscriber.next(undefined);
          return;
        }

        subscriber.next(withOptionalID(snapshot.data(), snapshot.id, options));
      },
      (error) => subscriber.error(error)
    );

    return unsubscribe;
  });
}
