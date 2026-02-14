import { Component, Inject, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { LoggerService } from '../../../../services/logger.service';

export interface DeviceNameEditDialogData {
  activityID: string;
  currentName: string;
  swInfo?: string;
}

@Component({
  selector: 'app-device-name-edit-dialog',
  templateUrl: './device-name-edit-dialog.component.html',
  styleUrls: ['./device-name-edit-dialog.component.css'],
  standalone: false,
})
export class DeviceNameEditDialogComponent {
  readonly minLength = 3;
  readonly maxLength = 20;
  private formBuilder = inject(FormBuilder);
  private logger = inject(LoggerService);

  readonly form;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: DeviceNameEditDialogData,
    private dialogRef: MatDialogRef<DeviceNameEditDialogComponent>,
  ) {
    this.data.currentName = `${this.data.currentName ?? ''}`.trim();
    this.form = this.formBuilder.group({
      deviceName: [
        this.data.currentName,
        [Validators.required, Validators.minLength(this.minLength), Validators.maxLength(this.maxLength)],
      ],
    });
  }

  close(): void {
    this.dialogRef.close();
  }

  save(): void {
    this.logger.log('[DeviceNameEditDialog] Save requested', {
      activityID: this.data.activityID,
      currentName: this.data.currentName,
      swInfo: this.data.swInfo,
      formValid: this.form.valid,
    });
    if (!this.form.valid) {
      this.logger.warn('[DeviceNameEditDialog] Form invalid, blocking save', {
        errors: this.form.controls.deviceName.errors,
      });
      this.form.markAllAsTouched();
      return;
    }

    const trimmedName = `${this.form.value.deviceName ?? ''}`.trim();
    if (!trimmedName || trimmedName === this.data.currentName) {
      this.logger.warn('[DeviceNameEditDialog] Name unchanged or empty, blocking save', {
        trimmedName,
      });
      return;
    }

    this.logger.log('[DeviceNameEditDialog] Closing dialog with new name', {
      activityID: this.data.activityID,
      newName: trimmedName,
    });
    this.dialogRef.close(trimmedName);
  }

  get isUnchanged(): boolean {
    const trimmedName = `${this.form.value.deviceName ?? ''}`.trim();
    return trimmedName === this.data.currentName;
  }
}
