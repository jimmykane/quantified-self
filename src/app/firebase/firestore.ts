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
  DocumentSnapshot as FirebaseDocumentSnapshot,
  Firestore as FirebaseFirestore,
  Query,
  QuerySnapshot as FirebaseQuerySnapshot
} from 'firebase/firestore';
import {
  getCountFromServer as firebaseGetCountFromServer,
  getDoc as firebaseGetDoc,
  getDocFromServer as firebaseGetDocFromServer,
  getDocs as firebaseGetDocs,
  getDocsFromCache as firebaseGetDocsFromCache,
  getDocsFromServer as firebaseGetDocsFromServer,
  onSnapshot as firebaseOnSnapshot,
} from 'firebase/firestore';
import { Observable } from 'rxjs';
import { FirebaseApp } from './app';
import { installFirestoreHttpResponseGuard } from './firestore-http-response-guard';

installFirestoreHttpResponseGuard();

export {
  Timestamp,
  addDoc,
  clearIndexedDbPersistence,
  collection,
  deleteField,
  deleteDoc,
  doc,
  documentId,
  endBefore,
  FieldPath,
  initializeFirestore,
  limit,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  runTransaction,
  serverTimestamp,
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
  waitForServer?: boolean;
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
        const zone = inject(NgZone, { optional: true });
        const firestore = runOutsideAngular(zone, factory);
        rememberFirestoreZone(firestore, zone);
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

function runOutsideAngular<T>(zone: NgZone | null, callback: () => T): T {
  return zone ? zone.runOutsideAngular(callback) : callback();
}

function listenOutsideAngular(zone: NgZone | null, register: () => () => void): () => void {
  // Firebase has no Angular scheduling API. Keep SDK transport, IndexedDB and teardown
  // tasks outside Angular; only application snapshot/error callbacks re-enter below.
  const unsubscribe = runOutsideAngular(zone, register);
  return () => runOutsideAngular(zone, unsubscribe);
}

// One-shot reads also start SDK/cache work. Preserve the SDK's generic signatures and
// promises; callers' await/then continuations retain their own Angular zone context.
export const getDoc: typeof firebaseGetDoc = reference => (
  runOutsideAngular(resolveNgZoneForSource(reference), () => firebaseGetDoc(reference))
);
export const getDocFromServer: typeof firebaseGetDocFromServer = reference => (
  runOutsideAngular(resolveNgZoneForSource(reference), () => firebaseGetDocFromServer(reference))
);
export const getDocs: typeof firebaseGetDocs = query => (
  runOutsideAngular(resolveNgZoneForSource(query), () => firebaseGetDocs(query))
);
export const getDocsFromCache: typeof firebaseGetDocsFromCache = query => (
  runOutsideAngular(resolveNgZoneForSource(query), () => firebaseGetDocsFromCache(query))
);
export const getDocsFromServer: typeof firebaseGetDocsFromServer = query => (
  runOutsideAngular(resolveNgZoneForSource(query), () => firebaseGetDocsFromServer(query))
);
export const getCountFromServer: typeof firebaseGetCountFromServer = query => (
  runOutsideAngular(resolveNgZoneForSource(query), () => firebaseGetCountFromServer(query))
);

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

  return listenOutsideAngular(zone, () => (
    (firebaseOnSnapshot as (...args: unknown[]) => ReturnType<typeof firebaseOnSnapshot>)(source, ...wrappedArgs)
  ));
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
    const next = (snapshot: FirebaseQuerySnapshot<T>) => {
      if (options?.waitForServer && (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)) {
        return;
      }

      const values = snapshot.docs.map((documentSnapshot) => {
        return withOptionalID(documentSnapshot.data() as T, documentSnapshot.id, options);
      });
      runInAngularZone(zone, () => subscriber.next(values));
    };
    const error = (snapshotError: Error) => runInAngularZone(zone, () => subscriber.error(snapshotError));
    return listenOutsideAngular(zone, () => options?.waitForServer
      ? firebaseOnSnapshot(query, { includeMetadataChanges: true }, next, error)
      : firebaseOnSnapshot(query, next, error));
  });
}

export function docData<T = DocumentData>(
  reference: DocumentReference<T>,
  options?: FirestoreDataOptions
): Observable<T | undefined> {
  const zone = resolveNgZoneForSource(reference);

  return new Observable<T | undefined>((subscriber) => {
    const next = (snapshot: FirebaseDocumentSnapshot<T>) => {
      if (options?.waitForServer && (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)) {
        return;
      }

      if (!snapshot.exists()) {
        runInAngularZone(zone, () => subscriber.next(undefined));
        return;
      }

      const value = withOptionalID(snapshot.data() as T, snapshot.id, options);
      runInAngularZone(zone, () => subscriber.next(value));
    };
    const error = (snapshotError: Error) => runInAngularZone(zone, () => subscriber.error(snapshotError));
    return listenOutsideAngular(zone, () => options?.waitForServer
      ? firebaseOnSnapshot(reference, { includeMetadataChanges: true }, next, error)
      : firebaseOnSnapshot(reference, next, error));
  });
}
