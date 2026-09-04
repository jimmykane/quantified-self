import { describe, expect, it, vi } from 'vitest';
import type { TrainingVisibleDiscipline } from '@shared/derived-metrics';
import { TrainingSportVisibilityDialogComponent } from './training-sport-visibility-dialog.component';

function createComponent(
  isAutomatic = true,
  visibleDisciplines: TrainingVisibleDiscipline[] = ['cycling'],
  availableDisciplines?: TrainingVisibleDiscipline[],
) {
  const dialogRef = { close: vi.fn() };
  const userSettingsService = { updateTrainingWorkspacePreferences: vi.fn().mockResolvedValue(undefined) };
  const changeDetector = { markForCheck: vi.fn() };
  const component = new TrainingSportVisibilityDialogComponent(
    { userUID: 'user-1', isAutomatic, visibleDisciplines, availableDisciplines },
    dialogRef as any,
    userSettingsService as any,
    changeDetector as any,
  );
  return { component, dialogRef, userSettingsService };
}

describe('TrainingSportVisibilityDialogComponent', () => {
  it('allows an unchanged automatic selection to be pinned explicitly', async () => {
    const { component, dialogRef, userSettingsService } = createComponent(true, ['cycling']);

    expect(component.canSave).toBe(true);
    expect(component.saveActionLabel).toBe('Keep these sports');
    await component.save();

    expect(userSettingsService.updateTrainingWorkspacePreferences).toHaveBeenCalledWith(
      'user-1',
      { sportShortcuts: ['cycling'] },
    );
    expect(dialogRef.close).toHaveBeenCalledWith({ saved: true, visibleDisciplines: ['cycling'] });
  });

  it('requires a changed, non-empty explicit selection', () => {
    const { component } = createComponent(false, ['cycling']);
    expect(component.saveActionLabel).toBe('Save selection');
    expect(component.canSave).toBe(false);

    component.setDisciplineSelected('cycling', false);
    expect(component.canSave).toBe(false);
    expect(component.errorMessage).toBe('Choose at least one sport shortcut.');

    component.setDisciplineSelected('running', true);
    expect(component.canSave).toBe(true);
    expect(component.errorMessage).toBeNull();
  });

  it('offers every registered family as an independent persisted selection', async () => {
    const { component, userSettingsService } = createComponent(false, ['cycling']);

    component.setDisciplineSelected('cycling', false);
    component.setDisciplineSelected('rowing', true);
    await component.save();

    expect(userSettingsService.updateTrainingWorkspacePreferences).toHaveBeenCalledWith(
      'user-1',
      { sportShortcuts: ['rowing'] },
    );
  });

  it('offers recorded-only families only when the workspace reports matching activities', () => {
    const { component } = createComponent(false, ['cycling'], ['cycling', 'fitness-gym']);

    expect(component.disciplineOptions.map(option => option.discipline)).toEqual(['cycling', 'fitness-gym']);
    expect(component.disciplineOptions.map(option => option.discipline)).not.toContain('other-training');
  });

  it('restores automatic mode with a null preference', async () => {
    const { component, dialogRef, userSettingsService } = createComponent(false, ['running']);

    await component.useAutomaticSelection();

    expect(userSettingsService.updateTrainingWorkspacePreferences).toHaveBeenCalledWith(
      'user-1',
      { sportShortcuts: null },
    );
    expect(dialogRef.close).toHaveBeenCalledWith({ saved: true, visibleDisciplines: null });
  });

  it('keeps the dialog open and exposes an accessible error after a failed save', async () => {
    const { component, dialogRef, userSettingsService } = createComponent();
    userSettingsService.updateTrainingWorkspacePreferences.mockRejectedValueOnce(new Error('offline'));

    await component.save();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.errorMessage).toBe('Could not save sport shortcuts. Try again.');
    expect(component.isSaving).toBe(false);
  });

  it('caps fixed shortcuts at four and disables unchecked options at the limit', () => {
    const { component } = createComponent(false, ['running', 'cycling', 'swimming', 'rowing']);

    expect(component.isDisciplineDisabled('strength')).toBe(true);
    component.setDisciplineSelected('strength', true);
    expect(component.errorMessage).toBe('Choose up to 4 sport shortcuts.');
    expect(component.selectedDisciplines.strength).toBe(false);
  });
});
