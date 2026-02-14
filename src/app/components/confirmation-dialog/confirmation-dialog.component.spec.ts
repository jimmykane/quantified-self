import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { ConfirmationDialogComponent } from './confirmation-dialog.component';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ConfirmationDialogComponent', () => {
  let fixture: ComponentFixture<ConfirmationDialogComponent>;
  let component: ConfirmationDialogComponent;
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };
  let bottomSheetRefMock: { dismiss: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    dialogRefMock = { close: vi.fn() };
    bottomSheetRefMock = { dismiss: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [ConfirmationDialogComponent],
      imports: [MatDialogModule, MatButtonModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MatBottomSheetRef, useValue: bottomSheetRefMock },
        { provide: MAT_DIALOG_DATA, useValue: null },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmationDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should provide generic defaults when no dialog data is passed', () => {
    expect(component.title).toBe('Are you sure?');
    expect(component.message).toContain('cannot be undone');
    expect(component.confirmButtonText).toBe('Confirm');
    expect(component.cancelButtonText).toBe('Cancel');
    expect(component.confirmColor).toBe('primary');
  });

  it('should use custom dialog data values', async () => {
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      declarations: [ConfirmationDialogComponent],
      imports: [MatDialogModule, MatButtonModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MatBottomSheetRef, useValue: bottomSheetRefMock },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            title: 'Reimport activity from file?',
            message: 'This will replace current activity data.',
            confirmText: 'Reimport',
            cancelText: 'Keep current',
            confirmColor: 'primary',
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmationDialogComponent);
    component = fixture.componentInstance;

    expect(component.title).toBe('Reimport activity from file?');
    expect(component.message).toBe('This will replace current activity data.');
    expect(component.confirmButtonText).toBe('Reimport');
    expect(component.cancelButtonText).toBe('Keep current');
    expect(component.confirmColor).toBe('primary');
  });

  it('should close dialog and bottom-sheet with selected decision', () => {
    component.onConfirm();
    expect(dialogRefMock.close).toHaveBeenCalledWith(true);
    expect(bottomSheetRefMock.dismiss).toHaveBeenCalledWith(true);
  });

  it('should support label aliases and hide cancel when requested', async () => {
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      declarations: [ConfirmationDialogComponent],
      imports: [MatDialogModule, MatButtonModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MatBottomSheetRef, useValue: bottomSheetRefMock },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            confirmLabel: 'Delete',
            cancelLabel: 'Abort',
            confirmColor: 'warn',
            showCancel: false,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmationDialogComponent);
    component = fixture.componentInstance;

    expect(component.confirmButtonText).toBe('Delete');
    expect(component.cancelButtonText).toBe('Abort');
    expect(component.showCancel).toBe(false);
    expect(component.confirmColor).toBe('warn');
  });
});
