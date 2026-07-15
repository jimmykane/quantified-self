import { describe, expect, it, vi } from 'vitest';
import { TrainingSportVisibilityDialogComponent } from './training-sport-visibility-dialog.component';

function createComponent(
  isAutomatic = true,
  visibleDisciplines: ('running' | 'cycling' | 'swimming')[] = ['cycling'],
) {
  const dialogRef = { close: vi.fn() };
  const functionsService = { call: vi.fn().mockResolvedValue({ data: { accepted: true } }) };
  const changeDetector = { markForCheck: vi.fn() };
  const component = new TrainingSportVisibilityDialogComponent(
    { isAutomatic, visibleDisciplines },
    dialogRef as any,
    functionsService as any,
    changeDetector as any,
  );
  return { component, dialogRef, functionsService };
}

describe('TrainingSportVisibilityDialogComponent', () => {
  it('allows an unchanged automatic selection to be pinned explicitly', async () => {
    const { component, dialogRef, functionsService } = createComponent(true, ['cycling']);

    expect(component.canSave).toBe(true);
    expect(component.saveActionLabel).toBe('Keep these sports');
    await component.save();

    expect(functionsService.call).toHaveBeenCalledWith('setTrainingVisibleDisciplines', {
      visibleDisciplines: ['cycling'],
    });
    expect(dialogRef.close).toHaveBeenCalledWith({ saved: true, visibleDisciplines: ['cycling'] });
  });

  it('requires a changed, non-empty explicit selection', () => {
    const { component } = createComponent(false, ['cycling']);
    expect(component.saveActionLabel).toBe('Save selection');
    expect(component.canSave).toBe(false);

    component.setDisciplineSelected('cycling', false);
    expect(component.canSave).toBe(false);
    expect(component.errorMessage).toBe('Keep at least one sport visible.');

    component.setDisciplineSelected('running', true);
    expect(component.canSave).toBe(true);
    expect(component.errorMessage).toBeNull();
  });

  it('offers Swimming as an independent persisted selection', async () => {
    const { component, functionsService } = createComponent(false, ['cycling']);

    component.setDisciplineSelected('cycling', false);
    component.setDisciplineSelected('swimming', true);
    await component.save();

    expect(functionsService.call).toHaveBeenCalledWith('setTrainingVisibleDisciplines', {
      visibleDisciplines: ['swimming'],
    });
  });

  it('restores automatic mode with a null preference', async () => {
    const { component, dialogRef, functionsService } = createComponent(false, ['running']);

    await component.useAutomaticSelection();

    expect(functionsService.call).toHaveBeenCalledWith('setTrainingVisibleDisciplines', {
      visibleDisciplines: null,
    });
    expect(dialogRef.close).toHaveBeenCalledWith({ saved: true, visibleDisciplines: null });
  });

  it('keeps the dialog open and exposes an accessible error after a failed save', async () => {
    const { component, dialogRef, functionsService } = createComponent();
    functionsService.call.mockRejectedValueOnce(new Error('offline'));

    await component.save();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.errorMessage).toBe('Could not save the sports shown. Try again.');
    expect(component.isSaving).toBe(false);
  });
});
