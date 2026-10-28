import { Injectable, inject, signal } from '@angular/core';
import { doc, Firestore, runTransaction } from '../firebase/firestore';
import type { AppUserInterface } from '../models/app-user.interface';
import type { DashboardTileLaneKey } from '../helpers/dashboard-tile-section.helper';
import { dashboardChartLibraryRevision, type DashboardChartLibrarySeen } from '../helpers/dashboard-chart-library-revision.helper';

/** Catalog notifications use existing profile settings, never chart-data subscriptions. */
@Injectable({ providedIn: 'root' })
export class DashboardChartDiscoveryService {
  private readonly firestore = inject(Firestore);
  private readonly acknowledged = signal<Record<string, DashboardChartLibrarySeen>>({});
  private readonly pending = new Map<string, Promise<void>>();

  seenRevision(user: AppUserInterface, lane: DashboardTileLaneKey): number {
    return Math.max(dashboardChartLibraryRevision(user.settings?.appSettings?.dashboardChartLibrarySeen?.[lane]),
      dashboardChartLibraryRevision(this.acknowledged()[user.uid]?.[lane]));
  }

  async acknowledge(user: AppUserInterface, lane: DashboardTileLaneKey, revision: number): Promise<void> {
    if (!user.uid || revision <= this.seenRevision(user, lane)) return;
    const key = `${user.uid}:${lane}`;
    const pending = this.pending.get(key);
    if (pending) {
      await pending;
      return this.acknowledge(user, lane, revision);
    }
    const reference = doc(this.firestore, 'users', user.uid, 'config', 'settings');
    const operation = runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(reference);
      const stored = dashboardChartLibraryRevision(snapshot.data()?.['appSettings']?.dashboardChartLibrarySeen?.[lane]);
      const next = Math.max(stored, dashboardChartLibraryRevision(revision));
      if (next > stored) transaction.set(reference, { appSettings: { dashboardChartLibrarySeen: { [lane]: next } } }, { merge: true });
      return next;
    }).then(next => {
      this.acknowledged.update(all => ({ ...all, [user.uid]: { ...all[user.uid], [lane]: Math.max(next, all[user.uid]?.[lane] ?? 0) } }));
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, operation);
    return operation;
  }
}
