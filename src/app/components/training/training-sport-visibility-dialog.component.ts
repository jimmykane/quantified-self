import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { TrainingVisibleDiscipline } from '@shared/derived-metrics';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import {
  TRAINING_SPORT_SHORTCUT_LIMIT,
  TRAINING_VISIBLE_DISCIPLINE_OPTIONS,
  trainingSportVisibilitySelectionKey,
} from '../../helpers/training-sport-visibility.helper';

export interface TrainingSportVisibilityDialogData {
  userUID: string;
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
  public readonly shortcutLimit = TRAINING_SPORT_SHORTCUT_LIMIT;
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
    private readonly userSettingsService: AppUserSettingsQueryService,
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
    if (selected && !this.selectedDisciplines[discipline] && this.buildSelection().length >= this.shortcutLimit) {
      this.errorMessage = `Choose up to ${this.shortcutLimit} sport shortcuts.`;
      return;
    }
    this.selectedDisciplines[discipline] = selected;
    this.errorMessage = this.buildSelection().length
      ? null
      : 'Choose at least one sport shortcut.';
    this.refreshCanSave();
  }

  public isDisciplineDisabled(discipline: TrainingVisibleDiscipline): boolean {
    return this.isSaving || (
      !this.selectedDisciplines[discipline]
      && this.buildSelection().length >= this.shortcutLimit
    );
  }

  public async save(): Promise<void> {
    const visibleDisciplines = this.buildSelection();
    if (!visibleDisciplines.length) {
      this.errorMessage = 'Choose at least one sport shortcut.';
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
      await this.userSettingsService.updateTrainingWorkspacePreferences(
        this.data.userUID,
        { sportShortcuts: visibleDisciplines },
      );
      const result: TrainingSportVisibilityDialogResult = { saved: true, visibleDisciplines };
      this.dialogRef.close(result);
    } catch {
      this.errorMessage = 'Could not save sport shortcuts. Try again.';
    } finally {
      this.isSaving = false;
      this.savingAction = null;
      this.changeDetector.markForCheck();
    }
  }
}
