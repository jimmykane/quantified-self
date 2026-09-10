import { inject, Injectable } from '@angular/core';
import { doc, Firestore, runTransaction } from '../firebase/firestore';
import { AppDashboardSettingsInterface } from '../models/app-user.interface';
import equal from 'fast-deep-equal';

export class DashboardConfigurationConflict extends Error {
  constructor() { super('Your dashboard changed. Close the editor and try again with the current layout.'); }
}

export function cloneDashboardSettings(settings: Partial<AppDashboardSettingsInterface>): AppDashboardSettingsInterface {
  return JSON.parse(JSON.stringify(settings || {}));
}

function fieldValue(settings: Partial<AppDashboardSettingsInterface>, key: string): unknown {
  if (key === 'tiles') return settings.tiles || [];
  if (key === 'showTodaySummary') return settings.showTodaySummary !== false;
  if (key === 'autoTiles') return settings.autoTiles || {};
  if (key === 'dismissedCuratedRecoveryNowTile') return settings.dismissedCuratedRecoveryNowTile === true;
  return settings[key] ?? null;
}

export function assertDashboardConfigurationCurrent(current: Partial<AppDashboardSettingsInterface>, expected: Partial<AppDashboardSettingsInterface>, keys: string[]): void {
  if (keys.some(key => !equal(fieldValue(current, key), fieldValue(expected, key)))) throw new DashboardConfigurationConflict();
}

/** Owner-scoped settings only. Transactions also guard drafts and Undo because
 * saved tiles use mutable order numbers rather than persistent tile IDs. */
@Injectable({ providedIn: 'root' })
export class DashboardConfigurationService {
  private readonly firestore = inject(Firestore);

  async save(uid: string, expected: Partial<AppDashboardSettingsInterface>, patch: Partial<AppDashboardSettingsInterface>): Promise<void> {
    if (!uid) throw new Error('A dashboard owner is required.');
    const baseline = cloneDashboardSettings(expected);
    const update = cloneDashboardSettings(patch);
    const reference = doc(this.firestore, 'users', uid, 'config', 'settings');
    await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.data()?.['dashboardSettings'] || {};
      if (snapshot.exists()) assertDashboardConfigurationCurrent(current, baseline, Object.keys(update));
      transaction.set(reference, { dashboardSettings: update }, { merge: true });
    });
  }
}
