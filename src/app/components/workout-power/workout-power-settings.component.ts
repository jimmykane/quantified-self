import { ActivityFilterPickerComponent } from '../shared/activity-filter-picker/activity-filter-picker.component';
import { ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, computed, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom, defaultIfEmpty } from 'rxjs';
import { FormControl, FormGroup } from '@angular/forms';
import { DataPower } from '@sports-alliance/sports-lib';
import { dayWorkoutLocalDate } from '@shared/day-workout';
import { WORKOUT_POWER_SPORTS, WORKOUT_POWER_PROVIDERS, WORKOUT_POWER_PROFILE_LIMIT, parseWorkoutPowerProfileV1,
  workoutFtpFamily, type SharedWorkoutFtpReferenceV1, type WorkoutPowerProfileV1, type WorkoutPowerSettingsV1 } from '@shared/workout-power-settings';
import { SharedModule } from '../../modules/shared.module';
import { WorkoutPowerSettingsService } from '../../services/workout-power-settings.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppUserService } from '../../services/app.user.service';
import { parsePowerZoneInput, POWER_PROVIDER_LABELS, workoutPowerSummary, workoutPowerZones } from '../../helpers/workout-power-settings.helper';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';

@Component({ selector: 'app-workout-power-settings', standalone: true, imports: [SharedModule, ActivityFilterPickerComponent],
  templateUrl: './workout-power-settings.component.html', styleUrls: ['./workout-power-settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush })
export class WorkoutPowerSettingsComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) uid!: string;
  private readonly service = inject(WorkoutPowerSettingsService);
  private readonly haptics = inject(AppHapticsService);
  private readonly users = inject(AppUserService);
  private readonly dialog = inject(MatDialog);
  private generation = 0;
  private sharedGeneration = 0;
  readonly sharedFtp = signal<SharedWorkoutFtpReferenceV1 | null>(null);
  readonly sharedBusy = signal(false);
  readonly sharedError = signal(false);
  readonly sharedEditorBusy = signal(false);
  readonly editingOverride = signal(false);
  readonly head = signal<WorkoutPowerSettingsV1 | null>(null);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly failed = signal(false);
  readonly sport = signal<WorkoutPowerProfileV1['sport']>(WORKOUT_POWER_SPORTS[0]);
  readonly sharedFamily = computed(() => workoutFtpFamily(this.sport()));
  readonly sharedSummary = computed(() => {
    const reference = this.sharedFtp();
    return reference ? workoutPowerSummary(reference, this.users.user()?.settings?.unitSettings) : '';
  });
  readonly sports = WORKOUT_POWER_SPORTS.map(value => ({ value, label: value }));
  readonly providers = WORKOUT_POWER_PROVIDERS;
  readonly providerLabels = POWER_PROVIDER_LABELS;
  readonly today = dayWorkoutLocalDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  readonly form = new FormGroup({ provider: new FormControl<WorkoutPowerProfileV1['provider']>('garmin', { nonNullable: true }),
    source: new FormControl('', { nonNullable: true }), kind: new FormControl<WorkoutPowerProfileV1['reference']['kind']>('functional-threshold-power', { nonNullable: true }),
    watts: new FormControl<number | null>(null), referenceDate: new FormControl(this.today, { nonNullable: true }),
    zones: new FormControl('', { nonNullable: true }) });
  ngOnChanges(): void { void this.load(); }
  ngOnDestroy(): void { this.generation++; }
  selection(): void { this.haptics.selection(); }
  powerUnit(): string { return resolveUnitAwareDisplayFromValue(DataPower.type, 1, this.users.user()?.settings?.unitSettings)?.unit ?? ''; }
  readonly selectedProfile = computed(() => this.head()?.profiles.find(p => p.sport === this.sport()));
  summary(profile: WorkoutPowerProfileV1): string { return workoutPowerSummary(profile, this.users.user()?.settings?.unitSettings); }
  zones(profile: WorkoutPowerProfileV1): string[] { return workoutPowerZones(profile, this.users.user()?.settings?.unitSettings); }
  selectSport(values: string[]): void {
    const sport = WORKOUT_POWER_SPORTS.find(sport => sport === values[0]);
    if (!sport || sport === this.sport() || this.busy() || this.form.dirty) return;
    this.sport.set(sport); this.reset(); this.selection(); void this.refreshSharedFtp();
  }
  reset(): void {
    const p = this.selectedProfile();
    this.editingOverride.set(!!p);
    this.form.reset({ provider: p?.provider ?? 'garmin', source: p?.source ?? '', kind: p?.reference.kind ?? 'functional-threshold-power',
      watts: p?.reference.watts ?? null, referenceDate: p?.referenceDate ?? this.today, zones: p?.zoneUpperBoundsWatts.join(', ') ?? '' });
  }
  beginOverride(): void { if (this.busy() || this.editingOverride()) return; this.editingOverride.set(true); this.selection(); }
  discard(): void {
    if (this.busy() || !this.form.dirty && (!this.editingOverride() || !!this.selectedProfile())) return;
    this.reset(); this.message.set(''); this.selection();
  }
  async refreshSharedFtp(feedback = false): Promise<void> {
    if (feedback && (this.busy() || this.sharedBusy())) return;
    if (feedback) this.selection();
    const token = ++this.sharedGeneration, generation = this.generation, uid = this.uid;
    const current = () => token === this.sharedGeneration && generation === this.generation && uid === this.uid;
    this.sharedFtp.set(null); if (!feedback) this.sharedError.set(false); this.sharedBusy.set(true);
    try {
      const reference = await this.service.loadSharedFtp(uid, this.sport());
      if (current()) { this.sharedFtp.set(reference); this.sharedError.set(false); }
    } catch {
      if (current()) { this.sharedError.set(true); if (feedback) this.haptics.error(); }
    } finally { if (current()) this.sharedBusy.set(false); }
  }
  async editSharedFtp(): Promise<void> {
    if (this.busy() || this.sharedEditorBusy() || !this.sharedFamily()) return;
    const generation = this.generation, uid = this.uid; this.sharedEditorBusy.set(true); this.selection();
    try {
      const { TrainingThresholdsDialogComponent } = await import('../training-load/training-thresholds-dialog.component');
      if (generation !== this.generation || uid !== this.uid) return;
      await firstValueFrom(this.dialog.open(TrainingThresholdsDialogComponent, { data: { uid } }).afterClosed().pipe(defaultIfEmpty(null)));
      if (generation === this.generation && uid === this.uid) await this.refreshSharedFtp();
    } catch {
      if (generation !== this.generation || uid !== this.uid) return;
      this.failed.set(true); this.message.set('Training thresholds could not be opened. Try again.'); this.haptics.error();
    } finally { if (generation === this.generation && uid === this.uid) this.sharedEditorBusy.set(false); }
  }
  async load(feedback = false): Promise<void> {
    const generation = ++this.generation;
    this.sharedGeneration++; this.sharedFtp.set(null); this.sharedError.set(false); this.sharedBusy.set(false); this.sharedEditorBusy.set(false);
    this.head.set(null); this.form.reset(); this.form.disable({ emitEvent: false }); this.busy.set(true); this.failed.set(false); this.message.set('');
    if (feedback) this.selection();
    try {
      const head = await this.service.load(this.uid);
      if (generation !== this.generation) return;
      this.head.set(head); this.reset(); await this.refreshSharedFtp();
    } catch {
      if (generation !== this.generation) return;
      this.failed.set(true); this.message.set('Power settings could not be verified. Reload to try again.');
      if (feedback) this.haptics.error();
    } finally { if (generation === this.generation) { this.busy.set(false); this.form.enable({ emitEvent: false }); } }
  }
  private draft(): WorkoutPowerProfileV1 {
    const value = this.form.getRawValue();
    if (value.referenceDate > this.today) throw Error('The reference date cannot be in the future.');
    return parseWorkoutPowerProfileV1({ sport: this.sport(), provider: value.provider, source: value.source,
      reference: { kind: value.kind, watts: value.watts }, referenceDate: value.referenceDate, zoneUpperBoundsWatts: parsePowerZoneInput(value.zones) });
  }
  draftError(): string | null { try { this.draft(); return null; } catch (error) { return error instanceof Error ? error.message : 'Check the power reference.'; } }
  valid(): boolean { return this.draftError() === null; }
  async save(remove = false): Promise<void> {
    const head = this.head(); if (!head || this.busy() || !remove && (!this.form.dirty || !this.valid()) || remove && !this.selectedProfile()) return;
    const profiles = head.profiles.filter(p => p.sport !== this.sport());
    if (!remove) profiles.push(this.draft());
    if (profiles.length > WORKOUT_POWER_PROFILE_LIMIT) { this.message.set(`Keep at most ${WORKOUT_POWER_PROFILE_LIMIT} sport references.`); return; }
    const generation = this.generation;
    this.busy.set(true); this.message.set(''); this.failed.set(false); this.form.disable({ emitEvent: false });
    try {
      const saved = await this.service.save(this.uid, head, profiles);
      if (generation !== this.generation) return;
      this.head.set(saved); this.reset(); this.message.set(remove ? 'Power override removed. Future generation uses shared FTP when available.' : 'Power override saved for future generation.');
      this.haptics.success();
    } catch (error) {
      if (generation !== this.generation) return;
      this.failed.set(true); this.message.set(error instanceof Error ? error.message : 'Save could not be confirmed. Reload before retrying.'); this.haptics.error();
    } finally { if (generation === this.generation) { this.busy.set(false); this.form.enable({ emitEvent: false }); } }
  }
}
