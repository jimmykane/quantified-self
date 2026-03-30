import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authState, user } from './auth';
import type { FirebaseAuthType, FirebaseUserType } from './auth';

const firebaseAuthMocks = vi.hoisted(() => {
  return {
    onAuthStateChanged: vi.fn(),
    onIdTokenChanged: vi.fn()
  };
});

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    onAuthStateChanged: firebaseAuthMocks.onAuthStateChanged,
    onIdTokenChanged: firebaseAuthMocks.onIdTokenChanged
  };
});

type NextListener = (value: FirebaseUserType | null) => void;
type ErrorListener = (error: unknown) => void;

describe('Firebase auth observables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('emits authState values inside Angular zone', () => {
    let nextListener: NextListener | undefined;

    firebaseAuthMocks.onAuthStateChanged.mockImplementation(
      (_auth: FirebaseAuthType, next: NextListener) => {
        nextListener = next;
        return vi.fn();
      }
    );

    const emittedValues: Array<FirebaseUserType | null> = [];
    const zoneStates: boolean[] = [];
    const observable = TestBed.runInInjectionContext(() =>
      authState({} as FirebaseAuthType)
    );
    const subscription = observable.subscribe((value) => {
      emittedValues.push(value);
      zoneStates.push(NgZone.isInAngularZone());
    });

    const emittedUser = { uid: 'u1' } as FirebaseUserType;
    TestBed.inject(NgZone).runOutsideAngular(() => {
      nextListener?.(emittedUser);
    });

    expect(emittedValues).toEqual([emittedUser]);
    expect(zoneStates).toEqual([true]);
    subscription.unsubscribe();
  });

  it('emits authState errors inside Angular zone', () => {
    let errorListener: ErrorListener | undefined;

    firebaseAuthMocks.onAuthStateChanged.mockImplementation(
      (_auth: FirebaseAuthType, _next: NextListener, error?: ErrorListener) => {
        errorListener = error;
        return vi.fn();
      }
    );

    const emittedErrors: unknown[] = [];
    const zoneStates: boolean[] = [];
    const observable = TestBed.runInInjectionContext(() =>
      authState({} as FirebaseAuthType)
    );
    const subscription = observable.subscribe({
      error: (error) => {
        emittedErrors.push(error);
        zoneStates.push(NgZone.isInAngularZone());
      }
    });

    const emittedError = new Error('auth listener failed');
    TestBed.inject(NgZone).runOutsideAngular(() => {
      errorListener?.(emittedError);
    });

    expect(emittedErrors).toEqual([emittedError]);
    expect(zoneStates).toEqual([true]);
    subscription.unsubscribe();
  });

  it('emits user values inside Angular zone', () => {
    let nextListener: NextListener | undefined;

    firebaseAuthMocks.onIdTokenChanged.mockImplementation(
      (_auth: FirebaseAuthType, next: NextListener) => {
        nextListener = next;
        return vi.fn();
      }
    );

    const emittedValues: Array<FirebaseUserType | null> = [];
    const zoneStates: boolean[] = [];
    const observable = TestBed.runInInjectionContext(() =>
      user({} as FirebaseAuthType)
    );
    const subscription = observable.subscribe((value) => {
      emittedValues.push(value);
      zoneStates.push(NgZone.isInAngularZone());
    });

    const emittedUser = { uid: 'u2' } as FirebaseUserType;
    TestBed.inject(NgZone).runOutsideAngular(() => {
      nextListener?.(emittedUser);
    });

    expect(emittedValues).toEqual([emittedUser]);
    expect(zoneStates).toEqual([true]);
    subscription.unsubscribe();
  });

  it('falls back gracefully when no injection context exists', () => {
    let nextListener: NextListener | undefined;

    firebaseAuthMocks.onAuthStateChanged.mockImplementation(
      (_auth: FirebaseAuthType, next: NextListener) => {
        nextListener = next;
        return vi.fn();
      }
    );

    const emittedValues: Array<FirebaseUserType | null> = [];
    const subscription = authState({} as FirebaseAuthType).subscribe((value) => {
      emittedValues.push(value);
    });

    const emittedUser = { uid: 'u3' } as FirebaseUserType;
    expect(() => nextListener?.(emittedUser)).not.toThrow();
    expect(emittedValues).toEqual([emittedUser]);
    subscription.unsubscribe();
  });
});
