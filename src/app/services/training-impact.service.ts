import { inject, Injectable } from '@angular/core';
import { DERIVED_METRIC_KINDS } from '@shared/derived-metrics';
import { catchError, distinctUntilChanged, map, Observable, of, shareReplay, startWith, switchMap, tap } from 'rxjs';
import type { DashboardFormPoint } from '../helpers/dashboard-form.helper';
import { AppUserService } from './app.user.service';
import {
  DashboardDerivedMetricsService,
  type DashboardDerivedMetricsState,
} from './dashboard-derived-metrics.service';

export type TrainingImpactSnapshotStatus = 'private' | 'updating' | 'ready' | 'error';

export interface TrainingImpactSnapshotState {
  status: TrainingImpactSnapshotStatus;
  formPoints: readonly DashboardFormPoint[] | null;
}

const UPDATING_STATE: TrainingImpactSnapshotState = { status: 'updating', formPoints: null };
const PRIVATE_STATE: TrainingImpactSnapshotState = { status: 'private', formPoints: null };
const ERROR_STATE: TrainingImpactSnapshotState = { status: 'error', formPoints: null };

@Injectable({ providedIn: 'root' })
export class TrainingImpactService {
  private readonly users = inject(AppUserService);
  private readonly derived = inject(DashboardDerivedMetricsService);
  private readonly ownerStreams = new Map<string, Observable<TrainingImpactSnapshotState>>();

  watch(uid: string): Observable<TrainingImpactSnapshotState> {
    const normalizedUid = `${uid || ''}`.trim();
    if (!normalizedUid) return of(PRIVATE_STATE);
    return this.users.user$.pipe(
      map(viewer => `${viewer?.uid || ''}`.trim()),
      distinctUntilChanged(),
      switchMap(viewerUid => viewerUid === normalizedUid
        ? this.watchOwner(normalizedUid)
        : of(PRIVATE_STATE)),
    );
  }

  private watchOwner(uid: string): Observable<TrainingImpactSnapshotState> {
    const existing = this.ownerStreams.get(uid);
    if (existing) return existing;
    const metricKinds = [DERIVED_METRIC_KINDS.Form] as const;
    const stream = this.derived.watch({ uid }, { metricKinds, reportReadErrors: true }).pipe(
      tap(state => this.derived.ensureForDashboard({ uid }, state, { metricKinds })),
      map(state => this.toImpactState(state)),
      startWith(UPDATING_STATE),
      catchError(() => of(ERROR_STATE)),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.ownerStreams.set(uid, stream);
    return stream;
  }

  private toImpactState(state: DashboardDerivedMetricsState): TrainingImpactSnapshotState {
    if (state.formStatus === 'failed') return ERROR_STATE;
    if (state.formStatus === 'ready' && Array.isArray(state.formPoints)) {
      return { status: 'ready', formPoints: state.formPoints };
    }
    return UPDATING_STATE;
  }
}
