import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirebaseApp } from './app';
import { Firestore, collectionData, docData, onSnapshot, provideFirestore } from './firestore';
import type { DocumentReference, FirebaseFirestoreType, Query } from './firestore';

const firebaseFirestoreMocks = vi.hoisted(() => {
  return {
    onSnapshot: vi.fn()
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    onSnapshot: firebaseFirestoreMocks.onSnapshot
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
}

interface DocumentSnapshot<T> {
  id: string;
  exists: () => boolean;
  data: () => T;
}

describe('Firebase firestore observables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    TestBed.resetTestingModule();
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
