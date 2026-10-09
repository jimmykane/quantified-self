import { ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { Subscription } from 'rxjs';
import { TRAINING_SPORT_DEFINITIONS, type TrainingSportId } from '@shared/training-disciplines';
import type { TrainingLoadMethod } from '@shared/training-load-policy';
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
  readonly rows = TRAINING_SPORT_DEFINITIONS.map(family => ({ ...family, revision: 0,
    form: new FormGroup({ method: new FormControl<TrainingLoadMethod>('AUTOMATIC', { nonNullable: true }),
      included: new FormControl(true, { nonNullable: true }) }) }));
  ngOnChanges(): void {
    this.generation++; this.subscription?.unsubscribe(); this.policies = [];
    this.loaded.set(false); this.message.set(''); this.busy.set(null);
    for (const row of this.rows) {
      row.revision = 0; row.form.enable({ emitEvent: false }); row.form.reset({ method: 'AUTOMATIC', included: true });
    }
    this.subscription = this.service.watchPolicies(this.uid).subscribe({ next: policies => {
      this.policies = policies;
      for (const row of this.rows) {
        if (row.form.dirty) continue;
        const policy = policies.find(policy => policy.id === row.id);
        row.revision = policy?.revision ?? 0;
        row.form.reset({ method: policy?.method ?? 'AUTOMATIC', included: policy?.included ?? true });
      }
      this.loaded.set(true);
    }, error: () => this.message.set('Training load preferences could not be loaded. Reopen Settings to try again.') });
  }
  ngOnDestroy(): void { this.generation++; this.subscription?.unsubscribe(); }
  selection(): void { this.haptics.selection(); }
  async save(row: typeof this.rows[number]): Promise<void> {
    if (this.busy() || !row.form.dirty) return;
    const generation = this.generation;
    const revision = row.revision + 1;
    const policy = row.form.getRawValue();
    this.busy.set(row.id); this.message.set(''); row.form.disable({ emitEvent: false });
    try {
      await this.service.savePolicy(this.uid, row.id, revision - 1, policy);
      if (generation !== this.generation) return;
      // Dirty drafts ignore live updates. After success, retain a newer head that
      // arrived while the transaction was pending instead of losing its revision.
      const latest = this.policies.find(head => head.id === row.id && head.revision >= revision);
      row.revision = latest?.revision ?? revision;
      row.form.reset({ method: latest?.method ?? policy.method, included: latest?.included ?? policy.included });
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
