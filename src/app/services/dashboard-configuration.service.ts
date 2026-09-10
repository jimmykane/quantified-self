import { inject, Injectable } from '@angular/core';
import { doc, Firestore, runTransaction } from '../firebase/firestore';
import { AppUserUtilities } from '../utils/app.user.utilities';
import { User } from '@sports-alliance/sports-lib';
import { AppDashboardSettingsInterface } from '../models/app-user.interface';
import equal from 'fast-deep-equal';

export class DashboardConfigurationConflict extends Error {
  constructor() { super('Your dashboard changed. Close the editor and try again with the current layout.'); }
}

export function cloneDashboardSettings(settings: Partial<AppDashboardSettingsInterface>): AppDashboardSettingsInterface {
  return JSON.parse(JSON.stringify(settings || {}));
}

function normalizeDashboardConfiguration(settings: Partial<AppDashboardSettingsInterface>): AppDashboardSettingsInterface {
  // Profile hydration migrates old tiles and fills defaults without writing them.
  // Compare that same representation, on copies so validation never mutates inputs.
  return AppUserUtilities.fillMissingAppSettings({
    settings: { dashboardSettings: cloneDashboardSettings(settings) },
  } as User).dashboardSettings;
}

export function assertDashboardConfigurationCurrent(current: Partial<AppDashboardSettingsInterface>, expected: Partial<AppDashboardSettingsInterface>, keys: string[]): void {
  const normalizedCurrent = normalizeDashboardConfiguration(current);
  const normalizedExpected = normalizeDashboardConfiguration(expected);
  if (keys.some(key => !equal(normalizedCurrent[key] ?? null, normalizedExpected[key] ?? null))) throw new DashboardConfigurationConflict();
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
