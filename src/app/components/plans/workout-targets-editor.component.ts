import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, input, output } from '@angular/core';
import { ActivityTypes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { WORKOUT_STRUCTURE_MAX_TARGETS_PER_STEP, type WorkoutTargetKindV1 } from '@shared/planned-workout';
import {
  WORKOUT_EDITOR_REFERENCE_OPTIONS, changeManualEditorTargetPresentation, createManualWorkoutEditorTarget,
  manualEditorTargetPreview, workoutEditorTargetUnit, type ManualWorkoutEditorTarget,
} from '../../helpers/planned-workout-target-editor.helper';
import { SharedModule } from '../../modules/shared.module';
import { AppHapticsService } from '../../services/app.haptics.service';
import { WorkoutTimeInputComponent } from './workout-time-input.component';

@Component({
  selector: 'app-workout-targets-editor', standalone: true,
  imports: [SharedModule, WorkoutTimeInputComponent],
  templateUrl: './workout-targets-editor.component.html',
  styleUrls: ['./workout-targets-editor.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkoutTargetsEditorComponent {
  readonly targets = input.required<ManualWorkoutEditorTarget[]>();
  readonly sport = input.required<ActivityTypes>();
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  readonly disabled = input(false);
  readonly targetsChange = output<ManualWorkoutEditorTarget[]>();
  private readonly haptics = inject(AppHapticsService);
  private readonly locale = inject(LOCALE_ID);
  readonly kinds: readonly { value: WorkoutTargetKindV1; label: string }[] = [
    { value: 'heart-rate', label: 'Heart rate' }, { value: 'power', label: 'Power' },
    { value: 'speed', label: 'Speed / pace' }, { value: 'cadence', label: 'Cadence' },
  ];
  readonly canAdd = computed(() => this.targets().length < WORKOUT_STRUCTURE_MAX_TARGETS_PER_STEP);
  readonly rows = computed(() => this.targets().map(target => {
    const unit = workoutEditorTargetUnit(target, this.sport(), this.unitSettings());
    const pace = target.kind === 'speed' && target.mode === 'absolute' && target.presentation === 'pace';
    return { target, unit, pace, references: WORKOUT_EDITOR_REFERENCE_OPTIONS[target.kind],
      kinds: this.kinds.map(option => ({ ...option, disabled: option.value !== target.kind && this.targets().some(other => other.kind === option.value) })),
      minimumLabel: target.rangeMode === 'single' ? `Value ${target.mode === 'relative' ? '(%)' : unit}`
        : pace ? `Faster ${unit}` : `Minimum (${target.mode === 'relative' ? '%' : unit})`,
      maximumLabel: pace ? `Slower ${unit}` : `Maximum (${target.mode === 'relative' ? '%' : unit})`,
      preview: manualEditorTargetPreview(target, this.sport(), this.unitSettings(), this.locale),
      savedReference: target.source?.target.mode === 'relative' && target.source.target.reference.kind === target.referenceKind
        && target.source.referenceValue === target.referenceValue,
    };
  }));

  add(): void {
    if (this.disabled() || !this.canAdd()) return;
    const kind = this.kinds.find(option => !this.targets().some(target => target.kind === option.value))?.value;
    if (!kind) return;
    this.haptics.selection();
    this.targetsChange.emit([...this.targets(), createManualWorkoutEditorTarget(kind)]);
  }
  remove(index: number): void {
    if (this.disabled() || !this.targets()[index]) return;
    this.haptics.selection();
    this.targetsChange.emit(this.targets().filter((_, candidate) => candidate !== index));
  }
  move(index: number, direction: -1 | 1): void {
    const destination = index + direction;
    if (this.disabled() || !this.targets()[index] || !this.targets()[destination]) return;
    const targets = [...this.targets()];
    targets.splice(destination, 0, ...targets.splice(index, 1));
    this.haptics.selection(); this.targetsChange.emit(targets);
  }
  select(index: number, field: 'kind' | 'mode' | 'presentation' | 'rangeMode' | 'referenceKind', value: string): void {
    const target = this.targets()[index];
    if (this.disabled() || !target || target[field] === value) return;
    let changed: ManualWorkoutEditorTarget;
    if (field === 'kind') {
      if (!this.kinds.some(option => option.value === value) || this.targets().some(other => other.kind === value)) return;
      changed = createManualWorkoutEditorTarget(value as WorkoutTargetKindV1);
    } else if (field === 'presentation' && (value === 'pace' || value === 'speed')) {
      changed = changeManualEditorTargetPresentation(target, value, this.sport(), this.unitSettings());
    } else if (field === 'mode' && (value === 'absolute' || value === 'relative')) {
      changed = { ...target, mode: value, minimum: null, maximum: null, referenceValue: null, source: undefined };
    } else if (field === 'rangeMode' && (value === 'single' || value === 'range')) {
      changed = { ...target, rangeMode: value, maximum: value === 'single' ? target.minimum : target.maximum };
    } else if (field === 'referenceKind') {
      const option = WORKOUT_EDITOR_REFERENCE_OPTIONS[target.kind].find(option => option.value === value);
      if (!option) return;
      changed = { ...target, referenceKind: option.value, referenceValue: null };
    } else return;
    this.haptics.selection(); this.replace(index, changed);
  }
  number(index: number, field: 'minimum' | 'maximum' | 'referenceValue', value: number | null): void {
    const target = this.targets()[index];
    if (this.disabled() || !target || Object.is(target[field], value)) return;
    this.replace(index, { ...target, [field]: value,
      ...(field === 'minimum' && target.rangeMode === 'single' ? { maximum: value } : {}) });
  }
  private replace(index: number, target: ManualWorkoutEditorTarget): void {
    this.targetsChange.emit(this.targets().map((original, candidate) => candidate === index ? target : original));
  }
}
