import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { describe, beforeEach, expect, it, vi } from 'vitest';

import { EventTagsBulkDialogComponent } from './event-tags-bulk-dialog.component';

function autocompleteEvent(value: string): any {
  return { option: { value } };
}

describe('EventTagsBulkDialogComponent', () => {
  let component: EventTagsBulkDialogComponent;
  let fixture: ComponentFixture<EventTagsBulkDialogComponent>;
  let save: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let snackbar: ReturnType<typeof vi.fn>;
  let dialogRef: { close: ReturnType<typeof vi.fn>; disableClose: boolean };

  beforeEach(() => {
    save = vi.fn().mockResolvedValue({});
    close = vi.fn();
    snackbar = vi.fn();
    dialogRef = { close, disableClose: false };
    TestBed.configureTestingModule({
      imports: [EventTagsBulkDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { selectedCount: 3, addSuggestions: ['Race'], removeSuggestions: ['Old'], save } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MatSnackBar, useValue: { open: snackbar } },
      ],
    });
    fixture = TestBed.createComponent(EventTagsBulkDialogComponent);
    component = fixture.componentInstance;
    (component as unknown as { snackBar: { open: typeof snackbar } }).snackBar = { open: snackbar };
    fixture.detectChanges();
  });

  it('stages separate add and remove changes and applies them', async () => {
    component.selectSuggestion('add', autocompleteEvent('Race'));
    component.selectSuggestion('remove', autocompleteEvent('Old'));

    await component.apply();

    expect(save).toHaveBeenCalledWith({ add: ['Race'], remove: ['Old'] });
    expect(close).toHaveBeenCalledWith(true);
  });

  it('prevents the same tag from being added and removed', () => {
    component.selectSuggestion('add', autocompleteEvent('Race'));
    component.selectSuggestion('remove', autocompleteEvent('race'));

    expect(component.addTags()).toEqual(['Race']);
    expect(component.removeTags()).toEqual([]);
    expect(snackbar).toHaveBeenCalledWith(
      'A tag cannot be added and removed in the same update.', undefined, { duration: 2500 },
    );
  });

  it('clears the native autocomplete input after selecting a suggestion', () => {
    const input = fixture.nativeElement.querySelector('input[placeholder="Add tag"]') as HTMLInputElement;
    input.value = 'Race';

    component.selectSuggestion('add', autocompleteEvent('Race'));

    expect(input.value).toBe('');
    expect(component.addInput()).toBe('');
  });

  it('applies the persisted tag length limit to both inputs', () => {
    const inputs = Array.from(fixture.nativeElement.querySelectorAll('input')) as HTMLInputElement[];

    expect(inputs.map(input => input.maxLength)).toEqual([32, 32]);
  });

  it('prevents escape and backdrop close while applying bulk changes', async () => {
    let resolveSave!: (value: unknown) => void;
    save.mockImplementationOnce(() => new Promise(resolve => {
      resolveSave = resolve;
    }));
    component.selectSuggestion('add', autocompleteEvent('Race'));

    const applyPromise = component.apply();
    expect(component.isSaving()).toBe(true);
    expect(dialogRef.disableClose).toBe(true);

    resolveSave({});
    await applyPromise;

    expect(dialogRef.disableClose).toBe(false);
    expect(close).toHaveBeenCalledWith(true);
  });
});
