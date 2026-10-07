import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TRAINING_PLAN_MAX_PHASES, parseTrainingPlanPhasesV1, validateTrainingPlanDateRange,
  validateTrainingPlanPhaseRange, type SetTrainingPlanPhasesMutationV1, type TrainingPlanPhaseV1, type TrainingPlanV1 } from '@shared/training-plans';
import { SharedModule } from '../../modules/shared.module';
import { TrainingPlansService } from '../../services/training-plans.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { TRAINING_PLAN_COLOR_OPTIONS } from '../../helpers/training-plan-appearance.helper';

export interface PlanPhasesDialogData { plan: TrainingPlanV1; currentWorkoutDates: readonly string[];
  onSave?: (operation: SetTrainingPlanPhasesMutationV1) => Promise<boolean>; }

@Component({
  selector: 'app-plan-phases-dialog', standalone: true, imports: [SharedModule],
  templateUrl: './plan-phases-dialog.component.html', styleUrls: ['./plan-phases-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanPhasesDialogComponent {
  readonly data = inject<PlanPhasesDialogData>(MAT_DIALOG_DATA);
  private readonly dialog = inject<MatDialogRef<PlanPhasesDialogComponent, SetTrainingPlanPhasesMutationV1>>(MatDialogRef);
  private readonly plans = inject(TrainingPlansService);
  private readonly haptics = inject(AppHapticsService);
  readonly colors = TRAINING_PLAN_COLOR_OPTIONS;
  readonly suggestions = ['Base', 'Build', 'Recovery', 'Taper'];
  readonly maxPhases = TRAINING_PLAN_MAX_PHASES;
  readonly items = signal<TrainingPlanPhaseV1[]>(structuredClone(this.data.plan.phases?.items ?? []));
  readonly start = signal(this.data.plan.startLocalDate);
  readonly end = signal(this.data.plan.endLocalDate);
  readonly confirmExtension = signal(false);
  readonly saving = signal(false);
  readonly extending = computed(() => this.start() < this.data.plan.startLocalDate || this.end() > this.data.plan.endLocalDate);
  readonly validation = computed(() => {
    try {
      validateTrainingPlanDateRange(this.start(), this.end());
      const phases = parseTrainingPlanPhasesV1({ version: 1, items: this.items() });
      validateTrainingPlanPhaseRange(phases, this.start(), this.end());
      if (this.data.currentWorkoutDates.some(date => date < this.start() || date > this.end())) {
        return { error: 'The plan range must contain every current workout. Move or remove excluded workouts first.', phases: null };
      }
      return { error: null, phases };
    } catch (error) { return { error: error instanceof Error ? error.message : 'Check phase names and dates.', phases: null }; }
  });
  readonly unchanged = computed(() => this.start() === this.data.plan.startLocalDate && this.end() === this.data.plan.endLocalDate
    && JSON.stringify(this.validation().phases?.items) === JSON.stringify(this.data.plan.phases?.items ?? []));

  add(name = ''): void {
    if (this.saving() || this.items().length >= this.maxPhases) return;
    this.items.update(items => [...items, { id: this.plans.createEntityId('phase'), name,
      startLocalDate: this.start(), endLocalDate: this.start() }]);
    this.haptics.selection();
  }
  update(id: string, field: 'name' | 'startLocalDate' | 'endLocalDate' | 'description' | 'color', value: string): void {
    if (this.saving()) return;
    this.items.update(items => items.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, [field]: value };
      if ((field === 'description' || field === 'color') && !value.trim()) delete updated[field];
      return updated as TrainingPlanPhaseV1;
    }));
  }
  remove(id: string): void {
    if (this.saving() || !this.items().some(item => item.id === id)) return;
    this.items.update(items => items.filter(item => item.id !== id));
    this.haptics.selection();
  }
  selectColor(id: string, value: string): void {
    const item = this.items().find(item => item.id === id);
    if (this.saving() || !item || (item.color ?? '') === value) return;
    this.update(id, 'color', value);
    this.haptics.selection();
  }
  setExtensionConfirmation(value: boolean): void {
    if (this.saving() || this.confirmExtension() === value) return;
    this.confirmExtension.set(value);
    this.haptics.selection();
  }
  setPlanDate(field: 'start' | 'end', value: string): void {
    if (this.saving() || this[field]() === value) return;
    this[field].set(value); this.confirmExtension.set(false);
  }
  async save(): Promise<void> {
    const phases = this.validation().phases;
    if (this.saving() || !phases || this.unchanged() || (this.extending() && !this.confirmExtension())) return;
    this.haptics.selection();
    const operation: SetTrainingPlanPhasesMutationV1 = { kind: 'set-plan-phases', planId: this.data.plan.id, phases,
      startLocalDate: this.start(), endLocalDate: this.end(), confirmPlanRangeExtension: this.extending() && this.confirmExtension() };
    if (!this.data.onSave) { this.dialog.close(operation); return; }
    this.saving.set(true); this.dialog.disableClose = true;
    try { if (await this.data.onSave(operation)) this.dialog.close(operation); }
    finally { this.saving.set(false); this.dialog.disableClose = false; }
  }
}
