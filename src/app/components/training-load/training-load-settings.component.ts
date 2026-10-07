import { ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { Subscription } from 'rxjs';
import { TRAINING_SPORT_DEFINITIONS, type TrainingSportId } from '@shared/training-disciplines';
import type { TrainingLoadMethod } from '@shared/training-load-policy';
import { SharedModule } from '../../modules/shared.module';
import { TrainingLoadService } from '../../services/training-load.service';
import { AppHapticsService } from '../../services/app.haptics.service';

@Component({ selector: 'app-training-load-settings', standalone: true, imports: [SharedModule],
  templateUrl: './training-load-settings.component.html', styleUrls: ['./training-load-settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingLoadSettingsComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) uid!: string;
  private readonly service = inject(TrainingLoadService);
  private readonly haptics = inject(AppHapticsService);
  private subscription?: Subscription;
  readonly loaded = signal(false);
  readonly busy = signal<TrainingSportId | null>(null);
  readonly message = signal('');
  readonly rows = TRAINING_SPORT_DEFINITIONS.map(family => ({ ...family, revision: 0,
    form: new FormGroup({ method: new FormControl<TrainingLoadMethod>('AUTOMATIC', { nonNullable: true }),
      included: new FormControl(true, { nonNullable: true }) }) }));
  ngOnChanges(): void {
    this.subscription?.unsubscribe(); this.loaded.set(false); this.message.set('');
    for (const row of this.rows) { row.revision = 0; row.form.reset({ method: 'AUTOMATIC', included: true }); }
    this.subscription = this.service.watchPolicies(this.uid).subscribe({ next: policies => {
      for (const row of this.rows) {
        if (row.form.dirty) continue;
        const policy = policies.find(policy => policy.id === row.id);
        row.revision = policy?.revision ?? 0;
        row.form.reset({ method: policy?.method ?? 'AUTOMATIC', included: policy?.included ?? true });
      }
      this.loaded.set(true);
    }, error: () => this.message.set('Training load preferences could not be loaded. Reopen Settings to try again.') });
  }
  ngOnDestroy(): void { this.subscription?.unsubscribe(); }
  selection(): void { this.haptics.selection(); }
  async save(row: typeof this.rows[number]): Promise<void> {
    if (this.busy() || !row.form.dirty) return;
    this.busy.set(row.id); this.message.set(''); row.form.disable({ emitEvent: false });
    try {
      await this.service.savePolicy(this.uid, row.id, row.revision, row.form.getRawValue());
      row.revision++; row.form.markAsPristine();
      this.message.set(`${row.label} preferences saved for workouts starting from now.`); this.haptics.success();
    } catch (error) { this.message.set(error instanceof Error ? error.message : 'Preferences could not be saved.'); this.haptics.error(); }
    finally { this.busy.set(null); row.form.enable({ emitEvent: false }); }
  }
}
