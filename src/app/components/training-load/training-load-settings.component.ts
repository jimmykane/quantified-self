import { ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, type SimpleChanges, inject, signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { Subscription } from 'rxjs';
import { TRAINING_SPORT_DEFINITIONS, type TrainingSportId } from '@shared/training-disciplines';
import { convertSpeedToSwimPace, convertSwimPaceToSpeed, convertSwimPaceToSwimPacePer100Yard, DataSwimPace, DataFTP, DataHeartRate, PaceUnits, SwimPaceUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { validSwimThresholdSpeed, validTrainingLoadPolicy, type TrainingLoadPolicy, type TrainingLoadMethod, type TrainingLoadHrAlgorithm } from '@shared/training-load-policy';
import { SharedModule } from '../../modules/shared.module';
import { TrainingLoadService, type TrainingLoadPolicyHead } from '../../services/training-load.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import type { TrainingFtpSuggestions } from '../../helpers/training-capacity.helper';
import { displayRunningThresholdPace, parseRunningThresholdPace, type RunningPaceUnit } from '@shared/running-threshold-pace';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { parsePaceDurationSeconds } from '@shared/pace-input';

@Component({ selector: 'app-training-load-settings', standalone: true, imports: [SharedModule],
  templateUrl: './training-load-settings.component.html', styleUrls: ['./training-load-settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingLoadSettingsComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) uid!: string;
  @Input() unitSettings?: UserUnitSettingsInterface;
  /** Health reuses this editor without exposing load-method or inclusion changes. */
  @Input() thresholdsOnly = false;
  readonly selectedFamily = signal<TrainingSportId>('cycling');
  readonly ftpUnit = new DataFTP(1).getDisplayUnit();
  readonly hrUnit = new DataHeartRate(1).getDisplayUnit();
  private readonly service = inject(TrainingLoadService);
  private readonly haptics = inject(AppHapticsService);
  private subscription?: Subscription;
  private generation = 0;
  private policies: TrainingLoadPolicyHead[] = [];
  readonly loaded = signal(false);
  readonly busy = signal<TrainingSportId | null>(null);
  readonly message = signal('');
  readonly ftpSuggestions = signal<TrainingFtpSuggestions>({});
  readonly rows = TRAINING_SPORT_DEFINITIONS.map(family => ({ ...family, revision: 0, cssUnit: 'm' as 'm' | 'yd', cssOriginalSpeed: undefined as number | undefined, cssOriginalText: '',
    runningPaceUnit: 'km' as RunningPaceUnit, runningOriginalSpeed: undefined as number | undefined, runningOriginalText: '',
    form: new FormGroup({ method: new FormControl<TrainingLoadMethod>('AUTOMATIC', { nonNullable: true }),
      included: new FormControl(true, { nonNullable: true }), cssPace: new FormControl('', { nonNullable: true }),
      ftp: new FormControl('', { nonNullable: true }), thresholdHr: new FormControl('', { nonNullable: true }),
      restingHr: new FormControl('', { nonNullable: true }), maxHr: new FormControl('', { nonNullable: true }),
      hrAlgorithm: new FormControl<TrainingLoadHrAlgorithm | ''>('', { nonNullable: true }),
      runningPace: new FormControl('', { nonNullable: true }) }) }));
  get visibleRows() { return this.thresholdsOnly ? this.rows.filter(row => row.id === this.selectedFamily()) : this.rows; }
  selectFamily(value: TrainingSportId): void { if (value !== this.selectedFamily()) { this.selectedFamily.set(value); this.selection(); } }
  ngOnChanges(changes?: SimpleChanges): void {
    const units = normalizeUserUnitSettings(this.unitSettings);
    const runningUnit = units.paceUnits[0] === PaceUnits.MinutesPerMile ? 'mi' : 'km';
    const swimUnit = units.swimPaceUnits[0] === SwimPaceUnits.MinutesPer100Yard ? 'yd' : 'm';
    if (changes?.unitSettings && !changes.uid) {
      // A profile-unit change is presentation only. Never reinterpret an in-progress draft,
      // restart the policy listener or fetch the optional FTP suggestions again.
      const previous = normalizeUserUnitSettings(changes.unitSettings.previousValue);
      for (const row of this.rows) {
        if (row.form.dirty) continue;
        if (previous.paceUnits[0] !== units.paceUnits[0]) {
          const speed = this.runningSpeed(row); row.runningPaceUnit = runningUnit; this.showRunningPace(row, speed);
        }
        if (previous.swimPaceUnits[0] !== units.swimPaceUnits[0]) {
          const speed = this.cssSpeed(row); row.cssUnit = swimUnit; this.showCss(row, speed);
        }
      }
      return;
    }
    this.generation++; this.subscription?.unsubscribe(); this.policies = [];
    const generation = this.generation;
    this.ftpSuggestions.set({});
    void this.service.readFtpSuggestions(this.uid).then(suggestions => {
      if (generation === this.generation) this.ftpSuggestions.set(suggestions);
    });
    this.loaded.set(false); this.message.set(''); this.busy.set(null);
    for (const row of this.rows) {
      row.revision = 0; row.cssUnit = swimUnit; row.runningPaceUnit = runningUnit; row.form.enable({ emitEvent: false }); this.loadPolicy(row, { method: 'AUTOMATIC', included: true });
    }
    this.subscription = this.service.watchPolicies(this.uid).subscribe({ next: policies => {
      this.policies = policies;
      for (const row of this.rows) {
        if (row.form.dirty) continue;
        const policy = policies.find(policy => policy.id === row.id);
        row.revision = policy?.revision ?? 0;
        this.loadPolicy(row, policy ?? { method: 'AUTOMATIC', included: true });
      }
      this.loaded.set(true);
    }, error: () => this.message.set('Training load preferences could not be loaded. Reopen Settings to try again.') });
  }
  ngOnDestroy(): void { this.generation++; this.subscription?.unsubscribe(); }
  selection(): void { this.haptics.selection(); }
  useFtpSuggestion(row: typeof this.rows[number]): void {
    const suggestion = this.ftpSuggestions()[row.id];
    if (!suggestion || this.busy() || !this.loaded() || Number(row.form.controls.ftp.value) === suggestion.value) return;
    row.form.controls.ftp.setValue(String(suggestion.value));
    row.form.controls.ftp.markAsDirty();
    this.haptics.selection();
  }
  private cssSpeed(row: typeof this.rows[number]): number | undefined {
    const pace = parsePaceDurationSeconds(row.form.controls.cssPace.value);
    if (pace === undefined) return undefined;
    // Equivalent clock text retains the exact saved speed behind its rounded display.
    if (pace === parsePaceDurationSeconds(row.cssOriginalText)) return row.cssOriginalSpeed;
    return convertSwimPaceToSpeed(row.cssUnit === 'yd' ? pace / convertSwimPaceToSwimPacePer100Yard(1) : pace);
  }
  validCss(row: typeof this.rows[number]): boolean {
    const speed = this.cssSpeed(row);
    return row.id !== 'swimming' || speed === undefined || validSwimThresholdSpeed(speed);
  }
  private runningSpeed(row: typeof this.rows[number]): number | undefined {
    const text = row.form.controls.runningPace.value.trim();
    return parsePaceDurationSeconds(text) === parsePaceDurationSeconds(row.runningOriginalText)
      ? row.runningOriginalSpeed : parseRunningThresholdPace(text, row.runningPaceUnit);
  }
  validRunningPace(row: typeof this.rows[number]): boolean {
    const speed = this.runningSpeed(row);
    return speed === undefined || Number.isFinite(speed) && speed > 0;
  }
  changeRunningPaceUnit(row: typeof this.rows[number], unit: RunningPaceUnit): void {
    const speed = this.runningSpeed(row);
    if (unit === row.runningPaceUnit || !this.validRunningPace(row)) return;
    row.runningPaceUnit = unit; this.showRunningPace(row, speed); this.selection();
  }
  private showRunningPace(row: typeof this.rows[number], speed?: number): void {
    row.runningOriginalSpeed = speed;
    row.runningOriginalText = speed === undefined ? '' : displayRunningThresholdPace(speed, row.runningPaceUnit);
    row.form.controls.runningPace.setValue(row.runningOriginalText, { emitEvent: false });
  }
  private policyDraft(row: typeof this.rows[number]): TrainingLoadPolicy {
    const { method, included, ftp, thresholdHr, restingHr, maxHr, hrAlgorithm } = row.form.getRawValue();
    const speed = row.id === 'swimming' ? this.cssSpeed(row) : undefined;
    const running = row.id === 'running' ? this.runningSpeed(row) : undefined;
    return { method, included, ...(speed !== undefined ? { swimThresholdSpeed: speed } : {}),
      ...(running !== undefined ? { runningThresholdSpeed: running } : {}),
      ...((row.id === 'running' || row.id === 'cycling') && ftp.trim() ? { functionalThresholdPower: Number(ftp) } : {}),
      ...(thresholdHr.trim() ? { lactateThresholdHR: Number(thresholdHr) } : {}),
      ...(restingHr.trim() ? { restingHeartRate: Number(restingHr) } : {}),
      ...(maxHr.trim() ? { maxHeartRate: Number(maxHr) } : {}), ...(hrAlgorithm ? { hrAlgorithm } : {}) };
  }
  validThresholds(row: typeof this.rows[number]): boolean { return validTrainingLoadPolicy(row.id, this.policyDraft(row)); }
  private showCss(row: typeof this.rows[number], speed?: number): void {
    row.cssOriginalSpeed = speed;
    const pace = speed === undefined ? null : convertSpeedToSwimPace(speed);
    row.cssOriginalText = pace === null ? '' : new DataSwimPace(Math.round(row.cssUnit === 'yd'
      ? convertSwimPaceToSwimPacePer100Yard(pace) : pace)).getDisplayValue();
    row.form.controls.cssPace.setValue(row.cssOriginalText, { emitEvent: false });
  }
  private loadPolicy(row: typeof this.rows[number], policy: TrainingLoadPolicy): void {
    row.form.reset({ method: policy.method, included: policy.included, cssPace: '', runningPace: '',
      ftp: policy.functionalThresholdPower === undefined ? '' : String(policy.functionalThresholdPower),
      thresholdHr: policy.lactateThresholdHR === undefined ? '' : String(policy.lactateThresholdHR),
      restingHr: policy.restingHeartRate === undefined ? '' : String(policy.restingHeartRate),
      maxHr: policy.maxHeartRate === undefined ? '' : String(policy.maxHeartRate), hrAlgorithm: policy.hrAlgorithm ?? '' });
    this.showCss(row, policy.swimThresholdSpeed);
    this.showRunningPace(row, policy.runningThresholdSpeed);
  }
  changeCssUnit(row: typeof this.rows[number], unit: 'm' | 'yd'): void {
    if (unit === row.cssUnit || !this.validCss(row)) return;
    const speed = this.cssSpeed(row);
    row.cssUnit = unit; this.showCss(row, speed); this.selection();
  }
  async save(row: typeof this.rows[number]): Promise<void> {
    if (this.busy() || !row.form.dirty || !this.validThresholds(row)) return;
    const generation = this.generation;
    const revision = row.revision + 1;
    const policy = this.policyDraft(row);
    this.busy.set(row.id); this.message.set(''); row.form.disable({ emitEvent: false });
    try {
      await this.service.savePolicy(this.uid, row.id, revision - 1, policy);
      if (generation !== this.generation) return;
      // Dirty drafts ignore live updates. After success, retain a newer head that
      // arrived while the transaction was pending instead of losing its revision.
      const latest = this.policies.find(head => head.id === row.id && head.revision >= revision);
      row.revision = latest?.revision ?? revision;
      this.loadPolicy(row, latest ?? policy);
      this.message.set(latest && latest.revision > revision
        ? `${row.label} preferences saved. A newer change from another session is now shown.`
        : `${row.label} preferences saved for workouts starting from now.`);
      this.haptics.success();
    } catch (error) {
      if (generation !== this.generation) return;
      this.message.set(error instanceof Error ? error.message : 'Preferences could not be saved.'); this.haptics.error();
    } finally {
      if (generation === this.generation) { this.busy.set(null); row.form.enable({ emitEvent: false }); }
    }
  }
}
