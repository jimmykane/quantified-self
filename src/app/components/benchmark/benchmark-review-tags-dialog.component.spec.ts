import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BenchmarkReviewTagsDialogComponent,
  BenchmarkReviewTagsDialogData,
} from './benchmark-review-tags-dialog.component';

describe('BenchmarkReviewTagsDialogComponent', () => {
  let fixture: ComponentFixture<BenchmarkReviewTagsDialogComponent>;
  let component: BenchmarkReviewTagsDialogComponent;
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };
  let dialogData: BenchmarkReviewTagsDialogData;

  beforeEach(async () => {
    dialogRefMock = { close: vi.fn() };
    snackBarMock = { open: vi.fn() };
    dialogData = {
      title: 'Comparison tags',
      tags: [' firmware ', 'Firmware'],
      suggestions: ['Route', 'Publication'],
      save: vi.fn().mockResolvedValue(['firmware', 'route']),
    };

    await TestBed.configureTestingModule({
      imports: [BenchmarkReviewTagsDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useFactory: () => dialogData },
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MatSnackBar, useValue: snackBarMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BenchmarkReviewTagsDialogComponent);
    component = fixture.componentInstance;
    (component as unknown as { snackBar: typeof snackBarMock }).snackBar = snackBarMock;
    fixture.detectChanges();
  });

  it('normalizes initial tags and stages chip input changes', () => {
    expect(component.stagedTags()).toEqual(['firmware']);
    expect(component.filteredSuggestions()).toEqual(['Publication', 'Route']);
    expect(component.hasChanges()).toBe(false);

    component.addTagFromInput({
      value: ' route ',
      chipInput: { clear: vi.fn() },
    } as never);
    component.removeTag('firmware');

    expect(component.stagedTags()).toEqual(['route']);
    expect(component.hasChanges()).toBe(true);
  });

  it('renders the Material chip remove icon for staged tags', () => {
    const removeButton = fixture.nativeElement.querySelector('mat-chip-row button[matChipRemove]') as HTMLButtonElement | null;
    const removeIcon = removeButton?.querySelector('mat-icon') as HTMLElement | null;

    expect(removeButton).toBeTruthy();
    expect(removeButton?.classList.contains('tag-remove-button')).toBe(true);
    expect(removeButton?.getAttribute('aria-label')).toBe('Remove firmware');
    expect(removeIcon).toBeTruthy();
    expect(removeIcon?.classList.contains('tag-remove-icon')).toBe(true);
    expect(removeIcon?.textContent?.trim()).toBe('close');
  });

  it('saves staged tags and closes with normalized saved tags', async () => {
    component.addTagFromInput({
      value: ' route ',
      chipInput: { clear: vi.fn() },
    } as never);

    await component.apply();

    expect(dialogData.save).toHaveBeenCalledWith(['firmware', 'route']);
    expect(dialogRefMock.close).toHaveBeenCalledWith(['firmware', 'route']);
  });

  it('keeps the dialog open and shows snackbar when saving fails', async () => {
    dialogData.save = vi.fn().mockRejectedValue(new Error('write failed'));
    component.addTagFromInput({
      value: ' route ',
      chipInput: { clear: vi.fn() },
    } as never);

    await component.apply();

    expect(dialogData.save).toHaveBeenCalledWith(['firmware', 'route']);
    expect(dialogRefMock.close).not.toHaveBeenCalled();
    expect(snackBarMock.open).toHaveBeenCalledWith('write failed', undefined, { duration: 3000 });
    expect(component.isSaving()).toBe(false);
  });

  it('closes without saving when tags are unchanged', async () => {
    await component.apply();

    expect(dialogData.save).not.toHaveBeenCalled();
    expect(dialogRefMock.close).toHaveBeenCalledWith(null);
  });
});
