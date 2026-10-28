import { inject, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirebaseApp } from './app';
import {
  Firestore, collectionData, docData, getCountFromServer, getDoc, getDocFromServer,
  getDocs, getDocsFromCache, getDocsFromServer, onSnapshot, provideFirestore,
} from './firestore';
import type { DocumentReference, FirebaseFirestoreType, Query } from './firestore';

const firebaseFirestoreMocks = vi.hoisted(() => {
  return {
    onSnapshot: vi.fn(),
    getDoc: vi.fn(), getDocFromServer: vi.fn(), getDocs: vi.fn(),
    getDocsFromCache: vi.fn(), getDocsFromServer: vi.fn(), getCountFromServer: vi.fn(),
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    ...firebaseFirestoreMocks,
  };
});

type SnapshotListener<T> = (snapshot: T) => void;
type ErrorListener = (error: unknown) => void;

interface QueryDocSnapshot<T> {
  id: string;
  data: () => T;
}

interface QuerySnapshot<T> {
  docs: Array<QueryDocSnapshot<T>>;
  metadata?: { fromCache: boolean; hasPendingWrites: boolean };
}

interface DocumentSnapshot<T> {
  id: string;
  exists: () => boolean;
  data: () => T;
  metadata?: { fromCache: boolean; hasPendingWrites: boolean };
}

describe('Firebase firestore observables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('initializes Firestore outside Angular while preserving the factory injection context', () => {
    const app = {};
    const firestore = {} as FirebaseFirestoreType;
    const factory = vi.fn(() => {
      expect(NgZone.isInAngularZone()).toBe(false);
      expect(inject(FirebaseApp)).toBe(app);
      return firestore;
    });
    TestBed.configureTestingModule({ providers: [
      { provide: FirebaseApp, useValue: app }, provideFirestore(factory),
    ] });
    const zone = TestBed.inject(NgZone);
    expect(zone.run(() => TestBed.inject(Firestore))).toBe(firestore);
    expect(factory).toHaveBeenCalledOnce();
  });

  it.each(['collectionData', 'docData', 'callbacks', 'observer', 'observer with options'] as const)(
    'registers and tears down %s outside Angular, delivering snapshots inside Angular', (kind) => {
      const firestore = {} as FirebaseFirestoreType;
      TestBed.configureTestingModule({ providers: [
        { provide: FirebaseApp, useValue: {} }, provideFirestore(() => firestore),
      ] });
      TestBed.inject(Firestore);
      const zone = TestBed.inject(NgZone);
      const source = { firestore } as Query & DocumentReference;
      let nextListener: (snapshot: unknown) => void;
      let completeListener: (() => void) | undefined;
      const teardownStates: boolean[] = [];
      firebaseFirestoreMocks.onSnapshot.mockImplementation((_source: unknown, ...args: unknown[]) => {
        expect(NgZone.isInAngularZone()).toBe(false);
        const observerOrCallback = args.find(arg => typeof arg === 'function' || (arg && typeof arg === 'object' && 'next' in arg));
        if (typeof observerOrCallback === 'function') {
          nextListener = observerOrCallback as (snapshot: unknown) => void;
          completeListener = args[args.indexOf(observerOrCallback) + 2] as (() => void) | undefined;
        } else {
          const observer = observerOrCallback as { next: (snapshot: unknown) => void; complete: () => void };
          nextListener = observer.next;
          completeListener = observer.complete;
        }
        return () => teardownStates.push(NgZone.isInAngularZone());
      });
      const deliveredStates: boolean[] = [];
      const observer = {
        next: () => deliveredStates.push(NgZone.isInAngularZone()),
        error: vi.fn(),
        complete: () => deliveredStates.push(NgZone.isInAngularZone()),
      };
      const unsubscribe = zone.run(() => {
        if (kind === 'collectionData') {
          const subscription = collectionData(source).subscribe(observer);
          return () => subscription.unsubscribe();
        }
        if (kind === 'docData') {
          const subscription = docData(source).subscribe(observer);
          return () => subscription.unsubscribe();
        }
        if (kind === 'callbacks') return onSnapshot(source, observer.next, observer.error, observer.complete);
        if (kind === 'observer with options') return onSnapshot(source, { includeMetadataChanges: true }, observer);
        return onSnapshot(source, observer);
      });
      zone.runOutsideAngular(() => nextListener({
        id: 'doc', exists: () => true, data: () => ({ value: 1 }),
        docs: [{ id: 'doc', data: () => ({ value: 1 }) }],
      }));
      expect(deliveredStates).toEqual([true]);
      if (kind !== 'collectionData' && kind !== 'docData') {
        zone.runOutsideAngular(() => completeListener?.());
        expect(deliveredStates).toEqual([true, true]);
      }
      zone.run(unsubscribe);
      expect(teardownStates).toEqual([false]);
    },
  );

  it('delivers docData failures inside Angular and tears the failed listener down outside it', () => {
    const zone = TestBed.inject(NgZone);
    let errorListener: ErrorListener;
    const teardownStates: boolean[] = [];
    firebaseFirestoreMocks.onSnapshot.mockImplementation((_source, _next, error: ErrorListener) => {
      expect(NgZone.isInAngularZone()).toBe(false);
      errorListener = error;
      return () => teardownStates.push(NgZone.isInAngularZone());
    });
    const failure = new Error('unavailable');
    const errorStates: boolean[] = [];
    const errors: unknown[] = [];
    TestBed.runInInjectionContext(() => zone.run(() => docData({} as DocumentReference).subscribe({
      error: error => { errors.push(error); errorStates.push(NgZone.isInAngularZone()); },
    })));
    zone.runOutsideAngular(() => errorListener(failure));
    expect(errors).toEqual([failure]);
    expect(errorStates).toEqual([true]);
    expect(teardownStates).toEqual([false]);
  });

  describe.each([
    { name: 'getDoc', read: getDoc, sdk: firebaseFirestoreMocks.getDoc },
    { name: 'getDocFromServer', read: getDocFromServer, sdk: firebaseFirestoreMocks.getDocFromServer },
    { name: 'getDocs', read: getDocs, sdk: firebaseFirestoreMocks.getDocs },
    { name: 'getDocsFromCache', read: getDocsFromCache, sdk: firebaseFirestoreMocks.getDocsFromCache },
    { name: 'getDocsFromServer', read: getDocsFromServer, sdk: firebaseFirestoreMocks.getDocsFromServer },
    { name: 'getCountFromServer', read: getCountFromServer, sdk: firebaseFirestoreMocks.getCountFromServer },
  ])('$name', ({ read, sdk }) => {
    const sourceForRegisteredZone = () => {
      const firestore = {} as FirebaseFirestoreType;
      TestBed.configureTestingModule({ providers: [
        { provide: FirebaseApp, useValue: {} }, provideFirestore(() => firestore),
      ] });
      TestBed.inject(Firestore);
      return { firestore } as Query & DocumentReference;
    };

    it('starts the SDK read outside Angular and preserves the caller continuation zone', async () => {
      const source = sourceForRegisteredZone();
      const result = { value: 'snapshot' };
      sdk.mockImplementation(() => {
        expect(NgZone.isInAngularZone()).toBe(false);
        return Promise.resolve(result);
      });
      const continuationStates: boolean[] = [];
      const returned = TestBed.inject(NgZone).run(() => read(source).then(snapshot => {
        continuationStates.push(NgZone.isInAngularZone());
        return snapshot;
      }));
      expect(await returned).toBe(result);
      expect(continuationStates).toEqual([true]);
      expect(sdk).toHaveBeenCalledExactlyOnceWith(source);
    });

    it('preserves SDK failures and the caller error continuation zone', async () => {
      const source = sourceForRegisteredZone();
      const failure = new Error('permission-denied');
      sdk.mockImplementation(() => {
        expect(NgZone.isInAngularZone()).toBe(false);
        return Promise.reject(failure);
      });
      const continuationStates: boolean[] = [];
      const returned = TestBed.inject(NgZone).run(() => read(source).catch(error => {
        continuationStates.push(NgZone.isInAngularZone());
        return error;
      }));
      expect(await returned).toBe(failure);
      expect(continuationStates).toEqual([true]);
    });
  });

  it('emits collectionData values inside Angular zone', () => {
    let nextListener: SnapshotListener<QuerySnapshot<{ name: string }>> | undefined;

    firebaseFirestoreMocks.onSnapshot.mockImplementation(
      (_source: unknown, next: SnapshotListener<QuerySnapshot<{ name: string }>>) => {
        nextListener = next;
        return vi.fn();
      }
    );

    const emittedValues: Array<Array<{ name: string; id: string }>> = [];
    const zoneStates: boolean[] = [];
    const observable = TestBed.runInInjectionContext(() =>
      collectionData<{ name: string }>({} as Query<{ name: string }>, { idField: 'id' })
    );
    const subscription = observable.subscribe((value) => {
      emittedValues.push(value as Array<{ name: string; id: string }>);
      zoneStates.push(NgZone.isInAngularZone());
    });

    TestBed.inject(NgZone).runOutsideAngular(() => {
      nextListener?.({
        docs: [
          { id: 'd1', data: () => ({ name: 'A' }) },
          { id: 'd2', data: () => ({ name: 'B' }) }
        ]
      });
    });

    expect(emittedValues).toEqual([[{ id: 'd1', name: 'A' }, { id: 'd2', name: 'B' }]]);
    expect(zoneStates).toEqual([true]);
    subscription.unsubscribe();
  });

  it('emits collectionData errors inside Angular zone', () => {
    let errorListener: ErrorListener | undefined;

    firebaseFirestoreMocks.onSnapshot.mockImplementation(
      (_source: unknown, _next: SnapshotListener<unknown>, error?: ErrorListener) => {
        errorListener = error;
        return vi.fn();
      }
    );

    const emittedErrors: unknown[] = [];
    const zoneStates: boolean[] = [];
    const observable = TestBed.runInInjectionContext(() =>
      collectionData({} as Query<{ name: string }>)
    );
    const subscription = observable.subscribe({
      error: (error) => {
        emittedErrors.push(error);
        zoneStates.push(NgZone.isInAngularZone());
      }
    });

    const emittedError = new Error('query failed');
    TestBed.inject(NgZone).runOutsideAngular(() => {
      errorListener?.(emittedError);
    });

    expect(emittedErrors).toEqual([emittedError]);
    expect(zoneStates).toEqual([true]);
    subscription.unsubscribe();
  });

  it('waits for a server-committed collectionData snapshot when requested', () => {
    let nextListener: SnapshotListener<QuerySnapshot<{ name: string }>> | undefined;

    firebaseFirestoreMocks.onSnapshot.mockImplementation(
      (_source: unknown, options: unknown, next: SnapshotListener<QuerySnapshot<{ name: string }>>) => {
        expect(options).toEqual({ includeMetadataChanges: true });
        nextListener = next;
        return vi.fn();
      }
    );

    const emittedValues: Array<Array<{ name: string }>> = [];
    const observable = TestBed.runInInjectionContext(() =>
      collectionData<{ name: string }>({} as Query<{ name: string }>, { waitForServer: true })
    );
    const subscription = observable.subscribe((value) => emittedValues.push(value));

    nextListener?.({
      docs: [{ id: 'cached', data: () => ({ name: 'Cached' }) }],
      metadata: { fromCache: true, hasPendingWrites: false }
    });
    nextListener?.({
      docs: [{ id: 'pending', data: () => ({ name: 'Pending' }) }],
      metadata: { fromCache: false, hasPendingWrites: true }
    });
    expect(emittedValues).toEqual([]);

    nextListener?.({
      docs: [{ id: 'committed', data: () => ({ name: 'Committed' }) }],
      metadata: { fromCache: false, hasPendingWrites: false }
    });
    expect(emittedValues).toEqual([[{ name: 'Committed' }]]);

    subscription.unsubscribe();
  });

  it('emits docData values inside Angular zone', () => {
    let nextListener: SnapshotListener<DocumentSnapshot<{ name: string }>> | undefined;

    firebaseFirestoreMocks.onSnapshot.mockImplementation(
      (_source: unknown, next: SnapshotListener<DocumentSnapshot<{ name: string }>>) => {
        nextListener = next;
        return vi.fn();
      }
    );

    const emittedValues: Array<{ name: string; id: string } | undefined> = [];
    const zoneStates: boolean[] = [];
    const observable = TestBed.runInInjectionContext(() =>
      docData<{ name: string }>(
        {} as DocumentReference<{ name: string }>,
        { idField: 'id' }
      )
    );
    const subscription = observable.subscribe((value) => {
      emittedValues.push(value as { name: string; id: string } | undefined);
      zoneStates.push(NgZone.isInAngularZone());
    });

    TestBed.inject(NgZone).runOutsideAngular(() => {
      nextListener?.({
        id: 'doc1',
        exists: () => true,
        data: () => ({ name: 'Doc Name' })
      });
    });

    expect(emittedValues).toEqual([{ id: 'doc1', name: 'Doc Name' }]);
    expect(zoneStates).toEqual([true]);
    subscription.unsubscribe();
  });

  it('emits undefined for missing docData snapshots inside Angular zone', () => {
    let nextListener: SnapshotListener<DocumentSnapshot<{ name: string }>> | undefined;

    firebaseFirestoreMocks.onSnapshot.mockImplementation(
      (_source: unknown, next: SnapshotListener<DocumentSnapshot<{ name: string }>>) => {
        nextListener = next;
        return vi.fn();
      }
    );

    const emittedValues: Array<{ name: string } | undefined> = [];
    const zoneStates: boolean[] = [];
    const observable = TestBed.runInInjectionContext(() =>
      docData<{ name: string }>({} as DocumentReference<{ name: string }>)
    );
    const subscription = observable.subscribe((value) => {
      emittedValues.push(value);
      zoneStates.push(NgZone.isInAngularZone());
    });

    TestBed.inject(NgZone).runOutsideAngular(() => {
      nextListener?.({
        id: 'doc2',
        exists: () => false,
        data: () => ({ name: 'Ignored' })
      });
    });

    expect(emittedValues).toEqual([undefined]);
    expect(zoneStates).toEqual([true]);
    subscription.unsubscribe();
  });

  it('waits for a server-confirmed docData snapshot when requested', () => {
    let nextListener: SnapshotListener<DocumentSnapshot<{ name: string }>> | undefined;

    firebaseFirestoreMocks.onSnapshot.mockImplementation(
      (_source: unknown, options: unknown, next: SnapshotListener<DocumentSnapshot<{ name: string }>>) => {
        expect(options).toEqual({ includeMetadataChanges: true });
        nextListener = next;
        return vi.fn();
      }
    );

    const emittedValues: Array<{ name: string } | undefined> = [];
    const observable = TestBed.runInInjectionContext(() =>
      docData<{ name: string }>(
        {} as DocumentReference<{ name: string }>,
        { waitForServer: true }
      )
    );
    const subscription = observable.subscribe((value) => emittedValues.push(value));

    nextListener?.({
      id: 'doc-cached',
      exists: () => false,
      data: () => ({ name: 'Ignored cache value' }),
      metadata: { fromCache: true, hasPendingWrites: false }
    });
    expect(emittedValues).toEqual([]);

    nextListener?.({
      id: 'doc-pending',
      exists: () => true,
      data: () => ({ name: 'Ignored pending value' }),
      metadata: { fromCache: false, hasPendingWrites: true }
    });
    expect(emittedValues).toEqual([]);

    nextListener?.({
      id: 'doc-server',
      exists: () => true,
      data: () => ({ name: 'Authoritative value' }),
      metadata: { fromCache: false, hasPendingWrites: false }
    });
    expect(emittedValues).toEqual([{ name: 'Authoritative value' }]);

    // A later cached miss must not turn already confirmed settings into "off".
    nextListener?.({
      id: 'doc-cached-missing', exists: () => false, data: () => undefined,
      metadata: { fromCache: true, hasPendingWrites: false }
    });
    expect(emittedValues).toEqual([{ name: 'Authoritative value' }]);
    nextListener?.({
      id: 'doc-server-missing', exists: () => false, data: () => undefined,
      metadata: { fromCache: false, hasPendingWrites: false }
    });
    expect(emittedValues).toEqual([{ name: 'Authoritative value' }, undefined]);

    subscription.unsubscribe();
  });

  it('uses provider-registered zone when collectionData is created outside injection context', () => {
    let nextListener: SnapshotListener<QuerySnapshot<{ name: string }>> | undefined;
    const firestoreInstance = {} as FirebaseFirestoreType;

    firebaseFirestoreMocks.onSnapshot.mockImplementation(
      (_source: unknown, next: SnapshotListener<QuerySnapshot<{ name: string }>>) => {
        nextListener = next;
        return vi.fn();
      }
    );

    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseApp, useValue: {} },
        provideFirestore(() => firestoreInstance),
      ],
    });
    TestBed.inject(Firestore);

    const emittedValues: Array<Array<{ name: string }>> = [];
    const zoneStates: boolean[] = [];
    const querySource = { firestore: firestoreInstance } as Query<{ name: string }>;
    const subscription = collectionData(querySource).subscribe((value) => {
      emittedValues.push(value);
      zoneStates.push(NgZone.isInAngularZone());
    });

    TestBed.inject(NgZone).runOutsideAngular(() => {
      nextListener?.({
        docs: [{ id: 'd-provider-zone', data: () => ({ name: 'Provider Zone' }) }]
      });
    });

    expect(emittedValues).toEqual([[{ name: 'Provider Zone' }]]);
    expect(zoneStates).toEqual([true]);
    subscription.unsubscribe();
  });

  it('wraps raw onSnapshot callbacks inside Angular zone outside injection context', () => {
    let nextListener: SnapshotListener<QuerySnapshot<{ name: string }>> | undefined;
    let errorListener: ErrorListener | undefined;
    const firestoreInstance = {} as FirebaseFirestoreType;

    firebaseFirestoreMocks.onSnapshot.mockImplementation(
      (_source: unknown, firstArg: unknown, secondArg?: unknown, thirdArg?: unknown) => {
        const hasOptionsArg = typeof firstArg !== 'function';
        const nextArg = hasOptionsArg ? secondArg : firstArg;
        const errorArg = hasOptionsArg ? thirdArg : secondArg;
        nextListener = nextArg as SnapshotListener<QuerySnapshot<{ name: string }>>;
        errorListener = errorArg as ErrorListener | undefined;
        return vi.fn();
      }
    );

    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseApp, useValue: {} },
        provideFirestore(() => firestoreInstance),
      ],
    });
    TestBed.inject(Firestore);

    const nextZoneStates: boolean[] = [];
    const errorZoneStates: boolean[] = [];
    const querySource = { firestore: firestoreInstance } as Query<{ name: string }>;
    const unsubscribe = onSnapshot(
      querySource,
      { includeMetadataChanges: false },
      (_snapshot) => {
        nextZoneStates.push(NgZone.isInAngularZone());
      },
      (_error) => {
        errorZoneStates.push(NgZone.isInAngularZone());
      }
    );

    const emittedError = new Error('raw listener failure');
    TestBed.inject(NgZone).runOutsideAngular(() => {
      nextListener?.({ docs: [{ id: 'd-raw', data: () => ({ name: 'Raw' }) }] });
      errorListener?.(emittedError);
    });

    expect(nextZoneStates).toEqual([true]);
    expect(errorZoneStates).toEqual([true]);
    unsubscribe();
  });

  it('falls back gracefully when no injection context exists', () => {
    let nextListener: SnapshotListener<QuerySnapshot<{ name: string }>> | undefined;

    firebaseFirestoreMocks.onSnapshot.mockImplementation(
      (_source: unknown, next: SnapshotListener<QuerySnapshot<{ name: string }>>) => {
        nextListener = next;
        return vi.fn();
      }
    );

    const emittedValues: Array<Array<{ name: string }>> = [];
    const subscription = collectionData<{ name: string }>(
      {} as Query<{ name: string }>
    ).subscribe((value) => {
      emittedValues.push(value);
    });

    expect(() => {
      nextListener?.({
        docs: [{ id: 'd1', data: () => ({ name: 'Fallback' }) }]
      });
    }).not.toThrow();
    expect(emittedValues).toEqual([[{ name: 'Fallback' }]]);
    subscription.unsubscribe();
  });
});
