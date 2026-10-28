import { AppHapticsService } from '../../../../services/app.haptics.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { DeviceNameEditDialogComponent } from './device-name-edit-dialog.component';

const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() };

describe('DeviceNameEditDialogComponent', () => {
  let component: DeviceNameEditDialogComponent;
  let fixture: ComponentFixture<DeviceNameEditDialogComponent>;
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    dialogRef = { close: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [DeviceNameEditDialogComponent],
      imports: [ReactiveFormsModule],
      providers: [
        { provide: AppHapticsService, useValue: haptics },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            activityID: 'a1',
            currentName: 'Garmin Edge',
            swInfo: '21.19',
          },
        },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(DeviceNameEditDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('initializes form with current device name', () => {
    expect(component.form.value.deviceName).toBe('Garmin Edge');
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('validates required and minimum length', () => {
    component.form.controls.deviceName.setValue('');
    expect(component.form.controls.deviceName.hasError('required')).toBe(true);

    component.form.controls.deviceName.setValue('ab');
    expect(component.form.controls.deviceName.hasError('minlength')).toBe(true);
  });

  it('closes with trimmed name on save when changed and valid', () => {
    component.form.controls.deviceName.setValue('  New Name  ');

    component.save();

    expect(dialogRef.close).toHaveBeenCalledWith('New Name');
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('does not close with value when name is unchanged', () => {
    component.form.controls.deviceName.setValue('Garmin Edge');

    component.save();

    expect(dialogRef.close).not.toHaveBeenCalledWith('Garmin Edge');
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('keeps invalid submissions silent', () => {
    component.form.controls.deviceName.setValue('');
    component.save();
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('close() dismisses dialog', () => {
    component.close();

    expect(dialogRef.close).toHaveBeenCalledWith();
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
});
