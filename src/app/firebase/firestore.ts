import {
  EnvironmentProviders,
  InjectionToken,
  NgZone,
  inject,
  makeEnvironmentProviders
} from '@angular/core';
import type {
  DocumentData,
  DocumentReference,
  Firestore as FirebaseFirestore,
  Query
} from 'firebase/firestore';
import { onSnapshot } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { FirebaseApp } from './app';

export {
  Timestamp,
  addDoc,
  clearIndexedDbPersistence,
  collection,
  deleteDoc,
  doc,
  documentId,
  endBefore,
  getCountFromServer,
  getDoc,
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  initializeFirestore,
  limit,
  onSnapshot,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  setDoc,
  startAfter,
  terminate,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
export type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Query,
  QueryDocumentSnapshot,
  QuerySnapshot,
  Firestore as FirebaseFirestoreType
} from 'firebase/firestore';

export const Firestore = new InjectionToken<FirebaseFirestore>('Firestore');

export interface FirestoreDataOptions {
  idField?: string;
}

export function provideFirestore(factory: () => FirebaseFirestore): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: Firestore,
      // `deps` forces FirebaseApp initialization before resolving Firestore.
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

  // Firestore listener callbacks can run outside Angular's zone.
  zone.run(callback);
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
  const zone = tryInjectNgZone();

  return new Observable<T[]>((subscriber) => {
    const unsubscribe = onSnapshot(
      query,
      (snapshot) => {
        const values = snapshot.docs.map((documentSnapshot) => {
          return withOptionalID(documentSnapshot.data(), documentSnapshot.id, options);
        });
        runInAngularZone(zone, () => subscriber.next(values));
      },
      (error) => runInAngularZone(zone, () => subscriber.error(error))
    );

    return unsubscribe;
  });
}

export function docData<T = DocumentData>(
  reference: DocumentReference<T>,
  options?: FirestoreDataOptions
): Observable<T | undefined> {
  const zone = tryInjectNgZone();

  return new Observable<T | undefined>((subscriber) => {
    const unsubscribe = onSnapshot(
      reference,
      (snapshot) => {
        if (!snapshot.exists()) {
          runInAngularZone(zone, () => subscriber.next(undefined));
          return;
        }

        runInAngularZone(zone, () => {
          subscriber.next(withOptionalID(snapshot.data(), snapshot.id, options));
        });
      },
      (error) => runInAngularZone(zone, () => subscriber.error(error))
    );

    return unsubscribe;
  });
}
