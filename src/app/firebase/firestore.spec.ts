import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectionData, docData } from './firestore';
import type { DocumentReference, Query } from './firestore';

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
