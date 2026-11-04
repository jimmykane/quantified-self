import { ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { Subscription } from 'rxjs';
import { TRAINING_SPORT_DEFINITIONS, type TrainingSportId } from '@shared/training-disciplines';
import { convertSpeedToSwimPace, convertSwimPaceToSpeed, convertSwimPaceToSwimPacePer100Yard, DataSwimPace } from '@sports-alliance/sports-lib';
import { validSwimThresholdSpeed, type TrainingLoadPolicy, type TrainingLoadMethod } from '@shared/training-load-policy';
import { SharedModule } from '../../modules/shared.module';
import { TrainingLoadService, type TrainingLoadPolicyHead } from '../../services/training-load.service';
import { AppHapticsService } from '../../services/app.haptics.service';

@Component({ selector: 'app-training-load-settings', standalone: true, imports: [SharedModule],
  templateUrl: './training-load-settings.component.html', styleUrls: ['./training-load-settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingLoadSettingsComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) uid!: string;
  private readonly service = inject(TrainingLoadService);
  private readonly haptics = inject(AppHapticsService);
  private subscription?: Subscription;
  private generation = 0;
  private policies: TrainingLoadPolicyHead[] = [];
  readonly loaded = signal(false);
  readonly busy = signal<TrainingSportId | null>(null);
  readonly message = signal('');
  readonly rows = TRAINING_SPORT_DEFINITIONS.map(family => ({ ...family, revision: 0, cssUnit: 'm' as 'm' | 'yd', cssOriginalSpeed: undefined as number | undefined, cssOriginalText: '',
    form: new FormGroup({ method: new FormControl<TrainingLoadMethod>('AUTOMATIC', { nonNullable: true }),
      included: new FormControl(true, { nonNullable: true }), cssPace: new FormControl('', { nonNullable: true }) }) }));
  ngOnChanges(): void {
    this.generation++; this.subscription?.unsubscribe(); this.policies = [];
    this.loaded.set(false); this.message.set(''); this.busy.set(null);
    for (const row of this.rows) {
      row.revision = 0; row.cssUnit = 'm'; row.form.enable({ emitEvent: false }); this.loadPolicy(row, { method: 'AUTOMATIC', included: true });
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
  private cssSpeed(row: typeof this.rows[number]): number | undefined {
    const text = row.form.controls.cssPace.value.trim();
    if (!text) return undefined;
    if (text === row.cssOriginalText) return row.cssOriginalSpeed;
    if (!/^\d{1,2}:[0-5]\d$/.test(text)) return NaN;
    const [minutes, seconds] = text.split(':').map(Number);
    const pace = minutes * 60 + seconds;
    return convertSwimPaceToSpeed(row.cssUnit === 'yd' ? pace / convertSwimPaceToSwimPacePer100Yard(1) : pace);
  }
  validCss(row: typeof this.rows[number]): boolean {
    const speed = this.cssSpeed(row);
    return row.id !== 'swimming' || speed === undefined || validSwimThresholdSpeed(speed);
  }
  private showCss(row: typeof this.rows[number], speed?: number): void {
    row.cssOriginalSpeed = speed;
    const pace = speed === undefined ? null : convertSpeedToSwimPace(speed);
    row.cssOriginalText = pace === null ? '' : new DataSwimPace(Math.round(row.cssUnit === 'yd'
      ? convertSwimPaceToSwimPacePer100Yard(pace) : pace)).getDisplayValue();
    row.form.controls.cssPace.setValue(row.cssOriginalText, { emitEvent: false });
  }
  private loadPolicy(row: typeof this.rows[number], policy: TrainingLoadPolicy): void {
    row.form.reset({ method: policy.method, included: policy.included, cssPace: '' });
    this.showCss(row, policy.swimThresholdSpeed);
  }
  changeCssUnit(row: typeof this.rows[number], unit: 'm' | 'yd'): void {
    if (unit === row.cssUnit || !this.validCss(row)) return;
    const speed = this.cssSpeed(row);
    row.cssUnit = unit; this.showCss(row, speed); this.selection();
  }
  async save(row: typeof this.rows[number]): Promise<void> {
    if (this.busy() || !row.form.dirty || !this.validCss(row)) return;
    const generation = this.generation;
    const revision = row.revision + 1;
    const { method, included } = row.form.getRawValue();
    const speed = row.id === 'swimming' ? this.cssSpeed(row) : undefined;
    const policy: TrainingLoadPolicy = { method, included, ...(speed !== undefined ? { swimThresholdSpeed: speed } : {}) };
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
