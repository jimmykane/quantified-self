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
import { onSnapshot as firebaseOnSnapshot } from 'firebase/firestore';
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

const firestoreZoneRegistry = new WeakMap<FirebaseFirestore, NgZone | null>();

function rememberFirestoreZone(firestore: FirebaseFirestore, zone: NgZone | null): void {
  firestoreZoneRegistry.set(firestore, zone);
}

export function provideFirestore(factory: () => FirebaseFirestore): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: Firestore,
      // `deps` forces FirebaseApp initialization before resolving Firestore.
      useFactory: (_firebaseApp: unknown) => {
        const firestore = factory();
        rememberFirestoreZone(firestore, inject(NgZone, { optional: true }));
        return firestore;
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

function resolveNgZoneForSource(source: Query<unknown> | DocumentReference<unknown>): NgZone | null {
  return tryInjectNgZone() ?? firestoreZoneRegistry.get(source.firestore) ?? null;
}

function runInAngularZone(zone: NgZone | null, callback: () => void): void {
  if (!zone) {
    callback();
    return;
  }

  // Firestore listener callbacks can run outside Angular's zone.
  zone.run(callback);
}

type SnapshotObserverLike = {
  next?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  complete?: (...args: unknown[]) => void;
};

function isSnapshotObserverLike(value: unknown): value is SnapshotObserverLike {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return 'next' in value || 'error' in value || 'complete' in value;
}

function wrapSnapshotCallback<T extends (...args: unknown[]) => void>(
  zone: NgZone | null,
  callback: T
): T {
  return ((...args: unknown[]) => {
    runInAngularZone(zone, () => callback(...args));
  }) as T;
}

function wrapSnapshotObserver(zone: NgZone | null, observer: SnapshotObserverLike): SnapshotObserverLike {
  return {
    ...observer,
    next: observer.next ? wrapSnapshotCallback(zone, observer.next) : observer.next,
    error: observer.error ? wrapSnapshotCallback(zone, observer.error) : observer.error,
    complete: observer.complete ? wrapSnapshotCallback(zone, observer.complete) : observer.complete,
  };
}

export const onSnapshot: typeof firebaseOnSnapshot = ((source: unknown, ...rest: unknown[]) => {
  const zone = resolveNgZoneForSource(source as Query<unknown> | DocumentReference<unknown>);
  const wrappedArgs = [...rest];
  const firstArgIsCallbackOrObserver = typeof wrappedArgs[0] === 'function' || isSnapshotObserverLike(wrappedArgs[0]);
  const callbackStartIndex = firstArgIsCallbackOrObserver ? 0 : 1;

  const nextOrObserver = wrappedArgs[callbackStartIndex];
  if (typeof nextOrObserver === 'function') {
    wrappedArgs[callbackStartIndex] = wrapSnapshotCallback(
      zone,
      nextOrObserver as (...args: unknown[]) => void
    );
  } else if (isSnapshotObserverLike(nextOrObserver)) {
    wrappedArgs[callbackStartIndex] = wrapSnapshotObserver(zone, nextOrObserver);
  }

  const errorCallbackIndex = callbackStartIndex + 1;
  if (typeof wrappedArgs[errorCallbackIndex] === 'function') {
    wrappedArgs[errorCallbackIndex] = wrapSnapshotCallback(zone, wrappedArgs[errorCallbackIndex] as (...args: unknown[]) => void);
  }

  const completeCallbackIndex = callbackStartIndex + 2;
  if (typeof wrappedArgs[completeCallbackIndex] === 'function') {
    wrappedArgs[completeCallbackIndex] = wrapSnapshotCallback(zone, wrappedArgs[completeCallbackIndex] as (...args: unknown[]) => void);
  }

  return (firebaseOnSnapshot as (...args: unknown[]) => ReturnType<typeof firebaseOnSnapshot>)(source, ...wrappedArgs);
}) as typeof firebaseOnSnapshot;

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
  const zone = resolveNgZoneForSource(query);

  return new Observable<T[]>((subscriber) => {
    const unsubscribe = firebaseOnSnapshot(
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
  const zone = resolveNgZoneForSource(reference);

  return new Observable<T | undefined>((subscriber) => {
    const unsubscribe = firebaseOnSnapshot(
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
