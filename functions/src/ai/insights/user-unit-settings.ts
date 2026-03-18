import * as admin from 'firebase-admin';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '../../../../shared/unit-aware-display';

interface LoadUserUnitSettingsDependencies {
  getSettingsData: (userID: string) => Promise<unknown>;
}

const defaultDependencies: LoadUserUnitSettingsDependencies = {
  getSettingsData: async (userID: string) => {
    const snapshot = await admin.firestore()
      .collection('users')
      .doc(userID)
      .collection('config')
      .doc('settings')
      .get();

    return snapshot.data();
  },
};

let dependencies: LoadUserUnitSettingsDependencies = defaultDependencies;

export function setLoadUserUnitSettingsDependenciesForTesting(
  overrides?: Partial<LoadUserUnitSettingsDependencies>,
): void {
  dependencies = overrides
    ? { ...defaultDependencies, ...overrides }
    : defaultDependencies;
}

export async function loadUserUnitSettings(userID: string): Promise<UserUnitSettingsInterface> {
  const rawSettings = await dependencies.getSettingsData(userID);
  const rawUnitSettings = (rawSettings && typeof rawSettings === 'object')
    ? (rawSettings as { unitSettings?: unknown }).unitSettings
    : undefined;

  return normalizeUserUnitSettings(rawUnitSettings);
}
