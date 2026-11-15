import { AppThemes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { DistanceUnits, GradeAdjustedPaceUnits, PaceUnits, WeightUnits } from '@sports-alliance/sports-lib/metrics';
import type { AppUserInterface } from '../models/app-user.interface';
import { applyPreferencesPreset, createPreferencesDraft, isPreferencesSetupWorkspace, needsPreferencesSetup, preferencesSetupPatch, preferencesSummary } from './preferences-setup.helper';
const owner = { uid: 'owner', onboardingCompleted: true, acceptedTos: true, acceptedPrivacyPolicy: true,
  acceptedDataPolicy: true, settings: { appSettings: { unitSetupCompleted: false },
    unitSettings: { distanceUnits: DistanceUnits.Kilometers, weightUnits: WeightUnits.Pounds, startOfTheWeek: 0,
      paceUnits: [PaceUnits.MinutesPerMile, PaceUnits.MinutesPerKilometer] } } } as AppUserInterface;
describe('shared preference setup', () => {
  it('requires explicit incomplete setup and completed policies; does not reprompt legacy accounts', () => {
    expect(needsPreferencesSetup(owner)).toBe(true);
    for (const field of ['onboardingCompleted', 'acceptedTos', 'acceptedPrivacyPolicy', 'acceptedDataPolicy']) {
      expect(needsPreferencesSetup({ ...owner, [field]: false })).toBe(false);
    }
    expect(needsPreferencesSetup(null)).toBe(false);
    expect(needsPreferencesSetup({ ...owner, settings: { ...owner.settings, appSettings: {} } })).toBe(false);
    expect(needsPreferencesSetup({ ...owner, settings: { ...owner.settings, appSettings: {unitSetupCompleted: true} } })).toBe(false);
  });
  it.each(['/dashboard', '/services?setup=sync', '/subscriptions', '/tools/compare', '/tools/compare/saved', '/training/plans', '/calendar', '/health'])('offers the same setup on %s', path => {
    expect(isPreferencesSetupWorkspace(path)).toBe(true);
  });
  it.each(['/', '/onboarding', '/login', '/settings', '/payment/success', '/mcp/authorize', '/share/event/owner/event', '/user/other/event/event', '/features/training-analysis', '/dashboard-other'])('excludes %s', path => {
    expect(isPreferencesSetupWorkspace(path)).toBe(false);
  });
  it('preserves current mixed units and independent weight/week start on opening', () => {
    const draft = createPreferencesDraft(owner);
    expect(draft.units.paceUnits).toEqual([PaceUnits.MinutesPerMile, PaceUnits.MinutesPerKilometer]);
    expect(preferencesSummary(draft.units)).toBe('Kilometers · Pounds (lb) · Sunday');
    const miles = applyPreferencesPreset(draft, 'miles');
    expect(miles.units).toMatchObject({ distanceUnits: DistanceUnits.Miles, weightUnits: WeightUnits.Pounds, startOfTheWeek: 0 });
    expect(draft.units.distanceUnits).toBe(DistanceUnits.Kilometers);
  });
  it('completes unchanged preferences without rewriting their units or other settings', () => {
    const draft = createPreferencesDraft(owner);
    expect(preferencesSetupPatch(draft, draft)).toEqual({ appSettings: { unitSetupCompleted: true } });
  });
  it('patches only accepted changes and synchronizes grade-adjusted pace', () => {
    const initial = createPreferencesDraft(owner);
    const draft = { ...initial, theme: AppThemes.Dark, units: { ...initial.units, paceUnits: [PaceUnits.MinutesPerKilometer] } };
    expect(preferencesSetupPatch(initial, draft)).toEqual({ appSettings: { unitSetupCompleted: true, themePreference: AppThemes.Dark },
      unitSettings: { paceUnits: [PaceUnits.MinutesPerKilometer], gradeAdjustedPaceUnits: [GradeAdjustedPaceUnits.MinutesPerKilometer] } });
  });
});
