import { ChangeDetectionStrategy, Component, inject, OnInit, signal, LOCALE_ID } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FormControl, FormGroup } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataTrainingStressScore, type User, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { AppEventInterface } from '@shared/app-event.interface';
import { defaultAppliedTrainingLoadPolicy, recordedTrainingStressScore, resolveEffectiveTrainingLoad,
  unresolvedTrainingLoadLegs, validTrainingLoadOverride, type TrainingLoadMetadata, type TrainingLoadMethod } from '@shared/training-load-policy';
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
  readonly form = new FormGroup({ method: new FormControl<TrainingLoadMethod>('AUTOMATIC', { nonNullable: true }),
    included: new FormControl(true, { nonNullable: true }), override: new FormControl<string | number | null>('', { nonNullable: true }),
    future: new FormControl(false, { nonNullable: true }) });

  async ngOnInit(): Promise<void> { await this.reload(); }
  private async reload(): Promise<void> {
    try {
      const [metadata, policies] = await Promise.all([
        firstValueFrom(this.service.watch(this.data.user.uid, this.data.event.getID() as string)),
        firstValueFrom(this.service.watchPolicies(this.data.user.uid)),
      ]);
      const sourceCurrent = !metadata?.parentFingerprint || metadata.parentFingerprint ===
        await browserTrainingLoadSourceFingerprint(this.data.event.toJSON());
      const legSourcesCurrent = await Promise.all(this.data.event.getActivities().map(async activity => {
        const saved = Object.values(metadata?.legs ?? {}).find(leg => leg.activityId === activity.getID());
        return !metadata?.legs || !!saved && (!saved.sourceFingerprint || saved.sourceFingerprint ===
          await browserTrainingLoadSourceFingerprint(activity.toJSON()));
      }));
      this.sourceCurrent.set(sourceCurrent && legSourcesCurrent.every(Boolean));
      this.metadata.set(metadata); this.policies.set(policies); this.loaded.set(true);
      if (!this.selectedId()) this.selectedId.set(this.activities[0]?.id ?? '');
      this.resetDraft();
    } catch { this.error.set('Training load could not be loaded. Close and try again.'); }
  }
  get selectedKey(): string {
    return Object.entries(this.metadata()?.controls ?? {}).find(([, control]) => control.activityId === this.selectedId())?.[0]
      ?? Object.entries(this.metadata()?.legs ?? {}).find(([, leg]) => leg.activityId === this.selectedId())?.[0] ?? this.selectedId();
  }
  get leg() { return Object.values(this.metadata()?.legs ?? {}).find(leg => leg.activityId === this.selectedId()); }
  get policy() { return this.metadata()?.legs?.[this.selectedKey]?.policy ?? this.leg?.policy ?? defaultAppliedTrainingLoadPolicy(this.activities.find(a => a.id === this.selectedId())?.type); }
  get family() { return resolveTrainingDisciplineFromActivityType(this.activities.find(activity => activity.id === this.selectedId())?.type); }
  get familyLabel(): string { return TRAINING_SPORT_DEFINITIONS.find(family => family.id === this.family)?.label ?? 'this sport'; }
  private resolveLoad(activityId?: string) {
    if (!this.sourceCurrent() && !this.metadata()?.excluded) return { score: null, status: 'unavailable' as const,
      method: null, estimated: false, reasons: ['source-updating'] };
    return resolveEffectiveTrainingLoad(this.data.event, this.metadata(), this.activities, activityId);
  }
  get model() { return this.resolveLoad(); }
  get legModel() { return this.resolveLoad(this.selectedId()); }
  get automatic(): number | null {
    return this.sourceCurrent() && !this.metadata()?.sourceWritePending ? (this.leg?.evaluations ? this.leg.evaluations.automatic.score : this.recorded) : null;
  }
  get recorded(): number | null { return recordedTrainingStressScore(this.activities.find(a => a.id === this.selectedId()) ?? {}); }
  get unresolved(): string[] { return this.metadata() ? unresolvedTrainingLoadLegs(this.metadata()!) : []; }
  get hasOverride(): boolean { return this.form.controls.override.value !== '' && this.form.controls.override.value !== null; }
  get valid(): boolean { return !this.hasOverride || validTrainingLoadOverride(Number(this.form.controls.override.value)); }
  get explanation(): string {
    if (this.legModel.status === 'excluded') return 'Excluded from modeled load. Activity history and volume are retained.';
    if (this.metadata()?.sourceWritePending) return 'This import is not complete. Training load is unavailable until it finishes. Retry the import if it failed; you can still exclude the whole workout.';
    if (this.legModel.reasons.includes('source-updating')) return 'The activity changed during reparse. Close this editor and reopen the activity to load its current legs.';
    if (this.legModel.reasons.includes('activity-match-needs-review')) return 'Review the unmatched legs below before using modeled load.';
    if (this.legModel.method === 'OVERRIDE') return 'The numeric override sets modeled load. Reset restores this leg’s saved policy.';
    if (!this.leg?.evaluations) return 'Recorded values are retained until reparse. Use “Reimport activity from file” in the activity menu to calculate HR and MET candidates.';
    if (this.legModel.method === 'IMPORTED') return 'The file supplied this score. Imported TSS takes precedence over the selected calculation method.';
    if (this.legModel.method === 'MET') return 'Estimate from file calories, body mass and duration. HR requires explicit resting, threshold and maximum HR in the file.';
    if (this.legModel.score === null) return 'No eligible load calculation is available from this file. Use a numeric override or exclude the leg.';
    return this.legModel.reasons.length ? 'The preferred calculation lacked the required file inputs. The next eligible Automatic method was used.' : 'Calculated from the available file inputs.';
  }
  get reasonText(): string {
    const messages: Record<string, string> = {
      'missing-hr-calibration': 'The file has no complete HR calibration.',
      'invalid-hr-calibration': 'The file HR calibration is inconsistent or invalid.',
      'ambiguous-hr-calibration': 'The file has ambiguous HR calibration records.',
      'missing-hr-samples': 'No usable heart-rate samples are available.',
      'missing-met-inputs': 'MET requires valid file calories, body mass and duration.',
      'missing-power-inputs': 'Power calculation inputs are unavailable.',
      'missing-pace-inputs': 'Pace calculation inputs are unavailable.',
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
      value.future && family ? { family, policy: { method: value.method, included: value.included },
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
    if (this.busy()) return;
    this.busy.set(true); this.error.set(''); this.form.disable({ emitEvent: false });
    try { await action(); await this.reload(); this.haptics.success(); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Could not save Training load.'); this.haptics.error(); }
    finally { this.busy.set(false); this.form.enable({ emitEvent: false }); }
  }
}
