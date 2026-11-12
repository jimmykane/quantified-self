import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal, LOCALE_ID } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FormControl, FormGroup } from '@angular/forms';
import { firstValueFrom, forkJoin, take } from 'rxjs';
import { convertSpeedToSwimPace, convertSpeedToPace, supportsRunningPaceTrainingStressScore, DataPace, DataSwimPace, DataTrainingStressScore, DataFTP, DataHeartRate, DataWeight, type User, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { AppEventInterface } from '@shared/app-event.interface';
import { defaultAppliedTrainingLoadPolicy, recordedTrainingStressScore, resolveEffectiveTrainingLoad,
  sameTrainingLoadCalibration,
  unresolvedTrainingLoadLegs, validTrainingLoadOverride, validTrainingLoadPolicy, type TrainingLoadMetadata, type TrainingLoadMethod,
  type EffectiveTrainingLoad } from '@shared/training-load-policy';
import { resolveTrainingDisciplineFromActivityType, TRAINING_SPORT_DEFINITIONS } from '@shared/training-disciplines';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';
import { browserTrainingLoadSourceFingerprint } from '@shared/training-load-source';
import { SharedModule } from '../../modules/shared.module';
import { TrainingLoadService, type TrainingLoadPolicyHead } from '../../services/training-load.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { getNumberFormatter } from '../../helpers/number-format.helper';

export interface TrainingLoadDialogData { event: AppEventInterface; user: User; unitSettings?: UserUnitSettingsInterface; }

@Component({ selector: 'app-training-load-dialog', standalone: true, imports: [SharedModule],
  templateUrl: './training-load-dialog.component.html', styleUrls: ['./training-load-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingLoadDialogComponent implements OnInit {
  readonly data = inject<TrainingLoadDialogData>(MAT_DIALOG_DATA);
  private readonly service = inject(TrainingLoadService);
  private readonly haptics = inject(AppHapticsService);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  readonly dialog = inject(MatDialogRef<TrainingLoadDialogComponent>);
  readonly metadata = signal<TrainingLoadMetadata | null>(null);
  readonly loaded = signal(false);
  readonly sourceCurrent = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly selectedId = signal('');
  readonly policies = signal<TrainingLoadPolicyHead[]>([]);
  readonly activities = this.data.event.getActivities().map(activity => ({ id: activity.getID() as string,
    type: activity.type, getStat: activity.getStat.bind(activity) }));
  readonly activityOptions = this.activities.map((activity, index, activities) => ({ id: activity.id,
    label: activities.filter(other => other.type === activity.type).length > 1
      ? `${activity.type || 'Unknown sport'} · Activity ${index + 1}` : activity.type || 'Unknown sport' }));
  // Legacy workouts can retain a parent score that differs even with only one activity.
  readonly showActivityLoad = computed(() => this.activities.length > 1 || this.model.score !== this.legModel.score);
  readonly form = new FormGroup({ method: new FormControl<TrainingLoadMethod>('AUTOMATIC', { nonNullable: true }),
    included: new FormControl(true, { nonNullable: true }), override: new FormControl<string | number | null>('', { nonNullable: true }),
    future: new FormControl(false, { nonNullable: true }) });

  async ngOnInit(): Promise<void> { await this.reload(); }
  private async reload(): Promise<boolean> {
    if (this.destroyRef.destroyed) return false;
    this.loaded.set(false);
    try {
      const [metadata, policies] = await firstValueFrom(forkJoin([
        this.service.watch(this.data.user.uid, this.data.event.getID() as string).pipe(take(1)),
        this.service.watchPolicies(this.data.user.uid).pipe(take(1)),
      ]).pipe(takeUntilDestroyed(this.destroyRef)));
      if (this.destroyRef.destroyed) return false;
      const sourceCurrent = !metadata?.parentFingerprint || metadata.parentFingerprint ===
        await browserTrainingLoadSourceFingerprint(this.data.event.toJSON());
      const legSourcesCurrent = await Promise.all(this.data.event.getActivities().map(async activity => {
        const saved = Object.values(metadata?.legs ?? {}).find(leg => leg.activityId === activity.getID());
        return !metadata?.legs || !!saved && (!saved.sourceFingerprint || saved.sourceFingerprint ===
          await browserTrainingLoadSourceFingerprint(activity.toJSON()));
      }));
      if (this.destroyRef.destroyed) return false;
      const currentIds = new Set(this.activities.map(activity => activity.id));
      const allSavedLegsPresent = Object.values(metadata?.legs ?? {}).every(leg => !leg.activityId || currentIds.has(leg.activityId));
      this.sourceCurrent.set(sourceCurrent && allSavedLegsPresent && legSourcesCurrent.every(Boolean));
      this.metadata.set(metadata); this.policies.set(policies);
      if (!this.selectedId()) this.selectedId.set(this.activities[0]?.id ?? '');
      this.resetDraft();
      this.loaded.set(true);
      return true;
    } catch {
      if (!this.destroyRef.destroyed) this.error.set('Training load could not be loaded. Close and try again.');
      return false;
    }
  }
  get selectedKey(): string {
    return Object.entries(this.metadata()?.controls ?? {}).find(([, control]) => control.activityId === this.selectedId())?.[0]
      ?? Object.entries(this.metadata()?.legs ?? {}).find(([, leg]) => leg.activityId === this.selectedId())?.[0] ?? this.selectedId();
  }
  get leg() { return Object.values(this.metadata()?.legs ?? {}).find(leg => leg.activityId === this.selectedId()); }
  get policy() { return this.metadata()?.legs?.[this.selectedKey]?.policy ?? this.leg?.policy ?? defaultAppliedTrainingLoadPolicy(this.activities.find(a => a.id === this.selectedId())?.type); }
  get savedCalibration() { const saved = this.metadata()?.legs?.[this.selectedKey]; return saved ? saved.calibration : this.leg?.calibration; }
  get family() { return resolveTrainingDisciplineFromActivityType(this.activities.find(activity => activity.id === this.selectedId())?.type); }
  get familyLabel(): string { return TRAINING_SPORT_DEFINITIONS.find(family => family.id === this.family)?.label ?? 'this sport'; }
  get canCopyToFuture(): boolean {
    const { method, included } = this.form.getRawValue();
    return validTrainingLoadPolicy(this.family, { method, included });
  }
  get runningPaceSupported(): boolean {
    const activity = this.activities.find(activity => activity.id === this.selectedId());
    return !!activity && supportsRunningPaceTrainingStressScore(activity.type);
  }
  private resolveLoad(activityId?: string): EffectiveTrainingLoad {
    if (!this.sourceCurrent() && !this.metadata()?.excluded) return { score: null, status: 'unavailable' as const,
      method: null, estimated: false, reasons: ['source-updating'] };
    return resolveEffectiveTrainingLoad(this.data.event, this.metadata(), this.activities, activityId);
  }
  get model() { return this.resolveLoad(); }
  get legModel() { return this.resolveLoad(this.selectedId()); }
  get actualMethodLabel(): string {
    const load = this.legModel;
    if (load.status === 'excluded') return 'Excluded';
    const method = load.method === 'PACE' ? 'Running pace' : load.method === 'SWIM_PACE' ? 'Swim pace (CSS)' : load.method === 'HR' && load.hrAlgorithm
      ? `HR · ${load.hrAlgorithm === 'BANISTER' ? 'Banister' : 'Threshold'}` : load.method ?? 'Unavailable';
    return method + (load.estimated ? ' (estimate)' : '');
  }
  get savedCssLabel(): string | null {
    const speed = this.policy.swimThresholdSpeed;
    if (speed === undefined) return null;
    const display = resolveUnitAwareDisplayFromValue(DataSwimPace.type, convertSpeedToSwimPace(speed), this.data.unitSettings,
      { roundSwimPaceSeconds: true });
    return display ? `${display.value} ${display.unit}` : null;
  }
  get savedThresholdLabels(): Array<{ label: string; value: string }> {
    const values: Array<[string, string, number | undefined]> = [
      ['Saved FTP fallback', DataFTP.type, this.policy.functionalThresholdPower],
      ['Saved threshold HR fallback', DataHeartRate.type, this.policy.lactateThresholdHR],
      ['Saved resting HR fallback', DataHeartRate.type, this.policy.restingHeartRate],
      ['Saved maximum HR fallback', DataHeartRate.type, this.policy.maxHeartRate],
    ];
    const labels = values.flatMap(([label, type, value]) => {
      const display = value === undefined ? null : resolveUnitAwareDisplayFromValue(type, value, this.data.unitSettings);
      return display ? [{ label, value: `${display.value} ${display.unit}` }] : [];
    });
    const speed = this.policy.runningThresholdSpeed;
    const pace = speed === undefined ? null : resolveUnitAwareDisplayFromValue(DataPace.type, convertSpeedToPace(speed), this.data.unitSettings,
      { roundPaceSeconds: true });
    if (this.policy.hrAlgorithm) labels.push({ label: 'Saved HR formula preference',
      value: this.policy.hrAlgorithm === 'BANISTER' ? 'Banister' : 'Threshold HR (estimate)' });
    return pace ? [...labels, { label: 'Saved running threshold pace fallback', value: `${pace.value} ${pace.unit}` }] : labels;
  }
  get savedHealthWeightLabel(): string | null {
    const weight = this.savedCalibration?.weight;
    if (weight?.status === 'unavailable') {
      if (weight.reason === 'missing') return 'Unavailable: no valid prior Health weight was available when MET was prepared.';
      if (weight.reason === 'conflicting') return 'Unavailable: the latest prior Health weights conflicted when MET was prepared.';
      return 'Unavailable: a reliable prior Health weight could not be established when MET was prepared.';
    }
    if (weight?.status !== 'available') return null;
    const display = resolveUnitAwareDisplayFromValue(DataWeight.type, weight.kilograms, this.data.unitSettings);
    const start = this.leg?.identity.startMs;
    if (!display || !Number.isFinite(new Date(weight.observedAtMs).getTime())) return null;
    const date = new Intl.DateTimeFormat(this.locale, { dateStyle: 'medium' }).format(weight.observedAtMs);
    const age = typeof start === 'number' && start >= weight.observedAtMs ? Math.floor((start - weight.observedAtMs) / 86400000) : null;
    return `${display.value} ${display.unit} · ${date}${age === null ? '' : ` · ${age} days before this workout`}`;
  }
  get automatic(): number | null {
    const leg = this.leg;
    // An override/exclusion can still resolve, but must not make a stale CSS comparison look current.
    if (leg && !sameTrainingLoadCalibration({ policy: this.policy, calibration: this.savedCalibration }, leg) &&
      leg?.evaluations?.automatic.provenance !== 'imported') return null;
    return this.sourceCurrent() && !this.metadata()?.sourceWritePending ? (leg?.evaluations ? leg.evaluations.automatic.score : this.recorded) : null;
  }
  get recorded(): number | null { return recordedTrainingStressScore(this.activities.find(a => a.id === this.selectedId()) ?? {}); }
  get unresolved(): string[] { return this.metadata() ? unresolvedTrainingLoadLegs(this.metadata()!) : []; }
  get hasOverride(): boolean { return this.form.controls.override.value !== '' && this.form.controls.override.value !== null; }
  get valid(): boolean { return !this.hasOverride || validTrainingLoadOverride(Number(this.form.controls.override.value)); }
  get explanation(): string {
    if (this.legModel.status === 'excluded') return 'Excluded from modeled load. Activity history and volume are retained.';
    if (this.metadata()?.sourceWritePending) return 'This import is not complete. Training load is unavailable until it finishes. Retry the import if it failed; you can still exclude the whole workout.';
    if (this.legModel.reasons.includes('source-updating')) return 'The workout changed during reparse. Close this editor and reopen the workout to load its current activities.';
    if (this.legModel.reasons.includes('met-weight-pending')) return 'Preparing the MET estimate using a Health weight measured at or before this workout. Recorded data stays unchanged.';
    if (this.legModel.reasons.includes('activity-match-needs-review')) return 'Review the unmatched activities below before using modeled load.';
    if (this.legModel.method === 'OVERRIDE') return 'The numeric override sets modeled load. Reset restores this activity’s saved policy.';
    if (this.legModel.reasons.includes('reparse-required') || !this.leg?.evaluations) return 'Recorded values are retained until reparse. Use “Reimport activity from file” in the activity menu to calculate available method candidates using the policy already saved for this workout. New FTP, threshold HR, running threshold pace or CSS settings do not apply retroactively.';
    if (this.legModel.method === 'IMPORTED') return 'The file supplied this score. Imported TSS takes precedence over the selected calculation method.';
    if (this.legModel.method === 'PACE') return 'Calculated from recorded running speed and grade, using valid file threshold pace or the threshold saved with this workout’s policy. Active timing, gaps and rolling-window coverage remain required.';
    if (this.legModel.method === 'SWIM_PACE' && this.savedCalibration?.version === 2)
      return 'Calculated from swim speed and valid file CSS, or the saved CSS fallback when file calibration is missing or unusable.';
    if (this.legModel.method === 'SWIM_PACE') return this.policy.swimThresholdSpeed !== undefined
      ? 'Calculated from swim speed and the CSS saved with this workout’s policy.'
      : 'Calculated from swim speed and an independent threshold supplied by the file.';
    if (this.legModel.method === 'MET') return 'Estimate from file calories and duration, using valid file body mass or the frozen prior Health weight fallback.';
    if (this.legModel.method === 'POWER') return 'Calculated from file power and active duration, using valid file FTP or this workout’s saved FTP fallback.';
    if (this.legModel.hrAlgorithm === 'BANISTER') return 'Calculated from recorded heart rate and explicit resting, threshold and maximum HR calibration.';
    if (this.legModel.hrAlgorithm === 'THRESHOLD') return 'Estimated from recorded heart rate relative to valid file threshold HR, or the saved threshold fallback when file calibration is missing or unusable. This estimate is used without assuming resting or maximum HR, when the sport supports calculated TSS.';
    if (this.legModel.score === null) return 'No eligible load calculation is available from the saved inputs. Use a numeric override or exclude the activity.';
    return this.legModel.reasons.length ? 'An eligible calculation was unavailable. The next eligible Automatic method was used.' : 'Calculated from the available file inputs.';
  }
  get reasonText(): string {
    const messages: Record<string, string> = {
      'unsupported-sport': 'This calculation is not supported for this sport.',
      'missing-hr-calibration': 'The file is missing required HR calibration.',
      'threshold-hr-fallback': 'The threshold-HR estimate was used with an independently valid threshold; resting and maximum HR are not assumed.',
      'requested-hr-algorithm-unavailable': 'The saved HR formula could not run with its required inputs or recorded coverage. Another eligible calculation was used.',
      'invalid-hr-calibration': 'The file HR calibration is inconsistent or invalid.',
      'ambiguous-hr-calibration': 'The file has ambiguous HR calibration records.',
      'missing-hr-samples': 'No usable heart-rate samples are available.',
      'missing-met-inputs': this.savedCalibration?.version === 2
        ? 'MET requires file calories and duration, plus valid file body mass or the saved prior Health weight fallback.'
        : 'MET requires valid file calories, body mass and duration.',
      'missing-power-inputs': 'Power calculation inputs are unavailable.',
      'missing-swim-threshold': 'No usable swim threshold is available. The workout’s average pace is not used as its threshold. Set CSS in Settings for future swims; this workout keeps its saved policy.',
      'missing-pace-inputs': 'Pace calculation inputs are unavailable.',
      'calculation-unavailable': 'A calculation could not produce a valid TSS from the available inputs.',
    };
    return [...new Set(this.legModel.reasons.map(reason => messages[reason]).filter(Boolean))].join(' ');
  }
  score(value: number | null): string {
    if (value === null) return 'Unavailable';
    // Resolve the canonical metric/unit through Sports Lib; the editor explicitly presents one decimal.
    const display = resolveUnitAwareDisplayFromValue(DataTrainingStressScore.type, value, this.data.unitSettings,
      { trainingStressScoreDecimals: 1 });
    return display ? `${getNumberFormatter(this.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(display.value))}${display.unit ? ` ${display.unit}` : ''}` : 'Unavailable';
  }
  selectLeg(id: string): void {
    if (id === this.selectedId()) return;
    this.selectedId.set(id); this.resetDraft(); this.haptics.selection();
  }
  selection(): void { this.haptics.selection(); }
  changeMethod(): void {
    if (!this.canCopyToFuture) this.form.controls.future.setValue(false, { emitEvent: false });
    this.selection();
  }
  private resetDraft(): void {
    const control = this.metadata()?.controls[this.selectedKey];
    this.form.reset({ method: control?.method ?? this.policy.method, included: control?.included ?? this.policy.included,
      override: control?.override ?? '', future: false });
  }
  async save(): Promise<void> {
    if (this.busy() || !this.sourceCurrent() || !this.valid || !this.form.dirty) return;
    const value = this.form.getRawValue();
    const family = this.family;
    await this.mutate(() => this.service.save(this.data.user.uid, this.data.event.getID() as string, this.metadata()?.revision ?? 0,
      { key: this.selectedKey, control: { ...((this.metadata()?.controls[this.selectedKey]?.activityId) ? { activityId: this.selectedId() } : {}), method: value.method, included: value.included,
        ...(this.hasOverride ? { override: Math.round(Number(value.override) * 10) / 10 } : {}) } },
      value.future && family && this.canCopyToFuture ? { family, policy: { method: value.method, included: value.included },
        expectedRevision: this.policies().find(policy => policy.id === family)?.revision ?? 0 } : undefined));
  }
  async resetLeg(): Promise<void> {
    if (!this.sourceCurrent()) return;
    const association = this.metadata()?.controls[this.selectedKey]?.activityId;
    await this.edit({ key: this.selectedKey, control: association ? { activityId: association } : null });
  }
  async resetWorkout(): Promise<void> { await this.edit({ reset: true }); }
  async excludeWorkout(excluded: boolean): Promise<void> { await this.edit({ excluded }); }
  async associate(key: string, activityId: string): Promise<void> {
    if (!this.sourceCurrent()) return;
    await this.edit({ key, control: { ...this.metadata()?.controls[key], activityId } });
  }
  async dismiss(key: string): Promise<void> { await this.edit({ key, control: { dismissed: true } }); }
  private async edit(edit: Parameters<TrainingLoadService['save']>[3]): Promise<void> {
    await this.mutate(() => this.service.save(this.data.user.uid, this.data.event.getID() as string, this.metadata()?.revision ?? 0, edit));
  }
  private async mutate(action: () => Promise<void>): Promise<void> {
    if (this.destroyRef.destroyed || this.busy() || !this.loaded()) return;
    this.busy.set(true); this.error.set(''); this.form.disable({ emitEvent: false });
    try {
      await action();
      if (this.destroyRef.destroyed) return;
      const reloaded = await this.reload();
      if (this.destroyRef.destroyed) return;
      if (reloaded) this.haptics.success();
      else {
        this.error.set('Changes were saved, but updated Training load could not be loaded. Close and reopen the editor before making further changes.');
        this.haptics.error();
      }
    }
    catch (error) {
      if (!this.destroyRef.destroyed) {
        this.error.set(error instanceof Error ? error.message : 'Could not save Training load.'); this.haptics.error();
      }
    }
    finally {
      if (!this.destroyRef.destroyed) { this.busy.set(false); this.form.enable({ emitEvent: false }); }
    }
  }
}
