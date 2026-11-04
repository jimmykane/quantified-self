import { ActivityFilterPickerComponent } from '../shared/activity-filter-picker/activity-filter-picker.component';
import { ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { DataPower } from '@sports-alliance/sports-lib';
import { dayWorkoutLocalDate } from '@shared/day-workout';
import { WORKOUT_POWER_SPORTS, WORKOUT_POWER_PROVIDERS, WORKOUT_POWER_PROFILE_LIMIT, parseWorkoutPowerProfileV1,
  type WorkoutPowerProfileV1, type WorkoutPowerSettingsV1 } from '@shared/workout-power-settings';
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
  private generation = 0;
  readonly head = signal<WorkoutPowerSettingsV1 | null>(null);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly failed = signal(false);
  readonly sport = signal<WorkoutPowerProfileV1['sport']>(WORKOUT_POWER_SPORTS[0]);
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
  selectedProfile(): WorkoutPowerProfileV1 | undefined { return this.head()?.profiles.find(p => p.sport === this.sport()); }
  summary(profile: WorkoutPowerProfileV1): string { return workoutPowerSummary(profile, this.users.user()?.settings?.unitSettings); }
  zones(profile: WorkoutPowerProfileV1): string[] { return workoutPowerZones(profile, this.users.user()?.settings?.unitSettings); }
  selectSport(values: string[]): void {
    const sport = WORKOUT_POWER_SPORTS.find(sport => sport === values[0]);
    if (!sport || sport === this.sport() || this.busy() || this.form.dirty) return;
    this.sport.set(sport); this.reset(); this.selection();
  }
  reset(): void {
    const p = this.selectedProfile();
    this.form.reset({ provider: p?.provider ?? 'garmin', source: p?.source ?? '', kind: p?.reference.kind ?? 'functional-threshold-power',
      watts: p?.reference.watts ?? null, referenceDate: p?.referenceDate ?? this.today, zones: p?.zoneUpperBoundsWatts.join(', ') ?? '' });
  }
  discard(): void { if (!this.form.dirty || this.busy()) return; this.reset(); this.message.set(''); this.selection(); }
  async load(feedback = false): Promise<void> {
    const generation = ++this.generation;
    this.head.set(null); this.form.reset(); this.form.disable({ emitEvent: false }); this.busy.set(true); this.failed.set(false); this.message.set('');
    if (feedback) this.selection();
    try {
      const head = await this.service.load(this.uid);
      if (generation !== this.generation) return;
      this.head.set(head); this.reset();
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
      this.head.set(saved); this.reset(); this.message.set(remove ? 'Power reference removed for future generation.' : 'Power reference saved for future generation.');
      this.haptics.success();
    } catch (error) {
      if (generation !== this.generation) return;
      this.failed.set(true); this.message.set(error instanceof Error ? error.message : 'Save could not be confirmed. Reload before retrying.'); this.haptics.error();
    } finally { if (generation === this.generation) { this.busy.set(false); this.form.enable({ emitEvent: false }); } }
  }
}
