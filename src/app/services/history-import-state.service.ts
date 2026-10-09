import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type HistoryImportDomain = 'activity' | 'sleep';
export interface HistoryImportRequestState<T> {
  status: 'idle' | 'pending' | 'success' | 'cooldown' | 'error';
  result?: T;
  nextAllowedAtMs?: number;
  range?: { startDate: Date; endDate: Date };
}

interface ImportEntry {
  state$: BehaviorSubject<HistoryImportRequestState<unknown>>;
  operation?: symbol;
}

/** In-memory request ownership survives tool-dialog teardown within this app instance. */
@Injectable({ providedIn: 'root' })
export class HistoryImportStateService {
  private entries = new Map<string, ImportEntry>();

  key(userID: string, provider: string, domain: HistoryImportDomain): string {
    return JSON.stringify([userID, provider, domain]);
  }

  watch$<T>(key: string): Observable<HistoryImportRequestState<T>> {
    return this.entry(key).state$.asObservable() as Observable<HistoryImportRequestState<T>>;
  }

  begin(key: string): symbol | null {
    const entry = this.entry(key);
    const state = entry.state$.value;
    if (state.status === 'pending' || (state.nextAllowedAtMs ?? 0) > Date.now()
      || (state.status === 'success' && state.nextAllowedAtMs === undefined)) return null;
    const operation = Symbol('history import');
    entry.operation = operation;
    entry.state$.next({ status: 'pending' });
    return operation;
  }

  finish<T>(key: string, operation: symbol, state: HistoryImportRequestState<T>): void {
    const entry = this.entry(key);
    if (entry.operation !== operation) return;
    entry.operation = undefined;
    entry.state$.next(state);
  }

  private entry(key: string): ImportEntry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { state$: new BehaviorSubject<HistoryImportRequestState<unknown>>({ status: 'idle' }) };
      this.entries.set(key, entry);
    }
    return entry;
  }
}

/** Only the existing callable cooldown contracts are normal wait outcomes. */
export function historyImportCooldownAt(error: unknown, domain: HistoryImportDomain): number | null {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const expectedCode = domain === 'activity' ? 'permission-denied' : 'resource-exhausted';
  if (candidate?.code !== expectedCode && candidate?.code !== `functions/${expectedCode}`) return null;
  if (typeof candidate.message !== 'string') return null;
  const prefix = domain === 'activity' ? 'History import is not allowed until ' : 'Sleep backfill is not allowed until ';
  if (!candidate.message.startsWith(prefix)) return null;
  const timestamp = candidate.message.slice(prefix.length);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp)) return null;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) && new Date(ms).toISOString() === timestamp ? ms : null;
}
