import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type {
  SetTrainingVisibleDisciplinesRequest,
  SetTrainingVisibleDisciplinesResponse,
  TrainingVisibleDiscipline,
} from '@shared/derived-metrics';
import { AppFunctionsService } from '../../services/app.functions.service';
import {
  TRAINING_VISIBLE_DISCIPLINE_OPTIONS,
  trainingSportVisibilitySelectionKey,
} from '../../helpers/training-sport-visibility.helper';

export interface TrainingSportVisibilityDialogData {
  visibleDisciplines: TrainingVisibleDiscipline[];
  isAutomatic: boolean;
}

export interface TrainingSportVisibilityDialogResult {
  saved: true;
  visibleDisciplines: TrainingVisibleDiscipline[] | null;
}

@Component({
  selector: 'app-training-sport-visibility-dialog',
  templateUrl: './training-sport-visibility-dialog.component.html',
  styleUrls: ['./training-sport-visibility-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TrainingSportVisibilityDialogComponent {
  public readonly disciplineOptions = TRAINING_VISIBLE_DISCIPLINE_OPTIONS;
  public readonly saveActionLabel: string;
  public selectedDisciplines: Record<TrainingVisibleDiscipline, boolean>;
  public isSaving = false;
  public savingAction: 'save' | 'automatic' | null = null;
  public canSave = true;
  public errorMessage: string | null = null;

  private readonly initialSelectionKey: string;

  constructor(
    @Inject(MAT_DIALOG_DATA) public readonly data: TrainingSportVisibilityDialogData,
    private readonly dialogRef: MatDialogRef<TrainingSportVisibilityDialogComponent>,
    private readonly functionsService: AppFunctionsService,
    private readonly changeDetector: ChangeDetectorRef,
  ) {
    this.saveActionLabel = data.isAutomatic ? 'Keep these sports' : 'Save selection';
    this.selectedDisciplines = Object.fromEntries(
      this.disciplineOptions.map(option => [option.discipline, data.visibleDisciplines.includes(option.discipline)]),
    ) as Record<TrainingVisibleDiscipline, boolean>;
    this.initialSelectionKey = trainingSportVisibilitySelectionKey(data.visibleDisciplines);
    this.refreshCanSave();
  }

  public setDisciplineSelected(discipline: TrainingVisibleDiscipline, selected: boolean): void {
    this.selectedDisciplines[discipline] = selected;
    this.errorMessage = this.buildSelection().length
      ? null
      : 'Keep at least one sport visible.';
    this.refreshCanSave();
  }

  public async save(): Promise<void> {
    const visibleDisciplines = this.buildSelection();
    if (!visibleDisciplines.length) {
      this.errorMessage = 'Keep at least one sport visible.';
      this.refreshCanSave();
      return;
    }
    await this.persist(visibleDisciplines, 'save');
  }

  public async useAutomaticSelection(): Promise<void> {
    await this.persist(null, 'automatic');
  }

  private buildSelection(): TrainingVisibleDiscipline[] {
    return this.disciplineOptions
      .filter(option => this.selectedDisciplines[option.discipline])
      .map(option => option.discipline);
  }

  private refreshCanSave(): void {
    const selection = this.buildSelection();
    this.canSave = selection.length > 0 && (
      this.data.isAutomatic
      || trainingSportVisibilitySelectionKey(selection) !== this.initialSelectionKey
    );
  }

  private async persist(
    visibleDisciplines: TrainingVisibleDiscipline[] | null,
    action: 'save' | 'automatic',
  ): Promise<void> {
    this.isSaving = true;
    this.savingAction = action;
    this.errorMessage = null;
    try {
      const response = await this.functionsService.call<
        SetTrainingVisibleDisciplinesRequest,
        SetTrainingVisibleDisciplinesResponse
      >('setTrainingVisibleDisciplines', { visibleDisciplines });
      if (response?.data?.accepted !== true) {
        throw new Error('The Training preference was not accepted.');
      }
      const result: TrainingSportVisibilityDialogResult = { saved: true, visibleDisciplines };
      this.dialogRef.close(result);
    } catch {
      this.errorMessage = 'Could not save the sports shown. Try again.';
    } finally {
      this.isSaving = false;
      this.savingAction = null;
      this.changeDetector.markForCheck();
    }
  }
}
