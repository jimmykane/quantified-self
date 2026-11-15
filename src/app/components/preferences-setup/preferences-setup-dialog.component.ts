import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { MatDialog, MatDialogModule, MAT_DIALOG_DATA, MatDialogRef, MatDialogState } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DataDistance, DataAltitude, DataPace, DataSpeed, DynamicDataLoader, PaceUnits, SpeedUnits, SwimPaceUnits, VerticalSpeedUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib/metrics';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
import { CompactSelectComponent } from '../shared/compact-select/compact-select.component';
import { PreferencesSetupService } from '../../services/preferences-setup.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppLocaleService } from '../../services/app.locale.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { AppUserInterface } from '../../models/app-user.interface';
import { applyPreferencesPreset, createPreferencesDraft, preferencesSetupPatch, PREFERENCE_WEIGHT_OPTIONS, PREFERENCE_WEEK_OPTIONS,
  PREFERENCE_DISTANCE_OPTIONS, PREFERENCE_ELEVATION_OPTIONS, PREFERENCE_THEME_OPTIONS, type PreferencesDraft } from '../../helpers/preferences-setup.helper';
import { resolveUnitSetupPreset, UNIT_SETUP_PRESET_OPTIONS, type UnitSetupPreset } from '../../helpers/unit-setup-preset.helper';
import { APP_FORMAT_LOCALE_OPTIONS, buildAppFormatLocalePreview } from '../../shared/adapters/app-locale';

type ArrayUnitKey = 'speedUnits' | 'paceUnits' | 'swimPaceUnits' | 'verticalSpeedUnits';
@Component({
  selector: 'app-preferences-setup-dialog', standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatButtonToggleModule, MatIconModule, MatSelectModule, MatProgressSpinnerModule, CompactSelectComponent],
  templateUrl: './preferences-setup-dialog.component.html', styleUrl: './preferences-setup-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreferencesSetupDialogComponent {
  readonly state = inject(PreferencesSetupService);
  private readonly data = inject<{ user: AppUserInterface }>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<PreferencesSetupDialogComponent>);
  private readonly dialogs = inject(MatDialog);
  private readonly haptics = inject(AppHapticsService);
  private readonly locale = inject(AppLocaleService);
  private readonly analytics = inject(AppAnalyticsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroy = inject(DestroyRef);
  private readonly ownerRevision = this.state.ownerRevision();
  private readonly saving = signal(false);
  private closing = false;
  readonly initial = createPreferencesDraft(this.data.user);
  readonly draft = signal(this.initial);
  readonly customUnits = signal(false);
  readonly appearance = signal(false);
  readonly loadingThresholds = signal(false);
  readonly thresholdError = signal('');
  readonly presets = UNIT_SETUP_PRESET_OPTIONS;
  readonly weights = PREFERENCE_WEIGHT_OPTIONS;
  readonly days = PREFERENCE_WEEK_OPTIONS;
  readonly distances = PREFERENCE_DISTANCE_OPTIONS;
  readonly elevations = PREFERENCE_ELEVATION_OPTIONS;
  readonly themes = PREFERENCE_THEME_OPTIONS;
  readonly locales = APP_FORMAT_LOCALE_OPTIONS;
  readonly arrayUnits: Array<{ key: ArrayUnitKey; label: string; options: Array<{ value: string; label: string }> }> = [
    ['speedUnits', 'Speed', SpeedUnits], ['paceUnits', 'Pace', PaceUnits], ['swimPaceUnits', 'Swim pace', SwimPaceUnits],
    ['verticalSpeedUnits', 'Vertical speed', VerticalSpeedUnits],
  ].map(([key, label, values]) => ({ key: key as ArrayUnitKey, label: label as string,
    options: Object.values(values).map(value => ({ value, label: DynamicDataLoader.getDataInstanceFromDataType(value, 0).getDisplayUnit() })) }));
  readonly preset = computed(() => resolveUnitSetupPreset(this.draft().units));
  readonly day = computed(() => String(this.draft().units.startOfTheWeek));
  readonly valid = computed(() => this.arrayUnits.every(field => this.draft().units[field.key].length > 0));
  readonly unitPreview = computed(() => [new DataDistance(10000), new DataPace(300), new DataSpeed(1), new DataAltitude(0)]
    .map(stat => resolveUnitAwareDisplayStat(stat, this.draft().units)?.unit).filter(Boolean).join(' · '));
  readonly appearanceSummary = computed(() => `${this.themes.find(option => option.value === this.draft().theme)?.label} theme · ${
    this.draft().formatLocale === 'auto' ? 'Automatic region' : this.locales.find(option => option.value === this.draft().formatLocale)?.label}`);
  readonly localePreview = computed(() => buildAppFormatLocalePreview(this.draft().formatLocale));

  constructor() {
    effect(() => {
      const staleOwner = this.state.user()?.uid !== this.data.user.uid || this.ownerRevision !== this.state.ownerRevision();
      // Another tab can finish setup while this review is open. Our own write may publish
      // its completion flag before its promise resolves, so let it finish its save feedback.
      const completedElsewhere = !this.state.due() && !this.state.busy() && !this.saving();
      if (staleOwner || completedElsewhere) this.closeDialog();
      this.ref.disableClose = this.state.busy() || this.saving();
    });
  }
  choosePreset(value: UnitSetupPreset): void {
    if (this.state.busy() || value === this.preset() || !this.presets.some(option => option.value === value)) return;
    this.draft.update(draft => applyPreferencesPreset(draft, value)); this.haptics.selection();
  }
  setUnit<K extends keyof UserUnitSettingsInterface>(key: K, value: UserUnitSettingsInterface[K]): void {
    if (this.state.busy() || JSON.stringify(value) === JSON.stringify(this.draft().units[key])) return;
    this.draft.update(draft => ({ ...draft, units: { ...draft.units, [key]: value } })); this.haptics.selection();
  }
  setDay(value: string): void { this.setUnit('startOfTheWeek', Number(value)); }
  setPreference<K extends 'theme' | 'formatLocale'>(key: K, value: PreferencesDraft[K]): void {
    if (this.state.busy() || this.draft()[key] === value) return;
    this.draft.update(draft => ({ ...draft, [key]: value })); this.haptics.selection();
  }
  toggle(section: 'units' | 'appearance'): void {
    if (this.state.busy()) return;
    (section === 'units' ? this.customUnits : this.appearance).update(value => !value); this.haptics.selection();
  }
  close(): void {
    if (this.state.busy() || this.saving() || this.closing) return;
    this.haptics.selection(); this.closeDialog();
  }
  private closeDialog(): void {
    if (this.closing) return;
    this.closing = true;
    this.ref.close();
  }
  async save(): Promise<void> {
    if (this.closing || this.state.busy() || this.saving() || !this.valid() || this.loadingThresholds()) return;
    const draft = this.draft();
    this.saving.set(true);
    try {
      if (!await this.state.complete(this.data.user.uid, preferencesSetupPatch(this.initial, draft), this.ownerRevision)) return;
      if (this.destroy.destroyed) return;
      this.analytics.logEvent('unit_setup_complete', { preset: this.preset() ?? 'custom' });
      const changedLocale = draft.formatLocale !== this.initial.formatLocale;
      const result = changedLocale ? this.locale.cachePreference(draft.formatLocale) : 'unchanged';
      this.snackBar.open(result === 'storage-unavailable' ? 'Preferences saved, but this browser could not apply the regional format.' : 'Preferences saved', undefined, { duration: 3000 });
      this.closeDialog();
      if (result === 'updated') this.locale.reload();
    } finally { this.saving.set(false); }
  }
  private activeReview(): boolean {
    return !this.destroy.destroyed && !this.closing && this.ref.getState() === MatDialogState.OPEN
      && this.state.user()?.uid === this.data.user.uid && this.ownerRevision === this.state.ownerRevision();
  }
  async openThresholds(): Promise<void> {
    if (this.state.busy() || this.loadingThresholds() || !this.activeReview()) return;
    this.loadingThresholds.set(true); this.thresholdError.set(''); this.haptics.selection();
    try {
      const { TrainingThresholdsDialogComponent } = await import('../training-load/training-thresholds-dialog.component');
      if (!this.activeReview()) return;
      // Reuse the existing editor; keep this unsaved preferences draft intact underneath.
      const dialog = this.dialogs.open(TrainingThresholdsDialogComponent, { width: '640px', maxWidth: '100vw',
        data: { uid: this.data.user.uid, unitSettings: this.state.user()?.settings?.unitSettings } });
      await new Promise<void>(resolve => dialog.afterClosed().subscribe(() => resolve()));
    } catch {
      if (this.activeReview()) { this.thresholdError.set('Could not open Training thresholds. Please try again.'); this.haptics.error(); }
    } finally { if (!this.destroy.destroyed) this.loadingThresholds.set(false); }
  }
}
