import { Component, Inject, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

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
    if (!this.form.valid) {
      this.form.markAllAsTouched();
      return;
    }

    const trimmedName = `${this.form.value.deviceName ?? ''}`.trim();
    if (!trimmedName || trimmedName === this.data.currentName) {
      return;
    }

    this.dialogRef.close(trimmedName);
  }

  get isUnchanged(): boolean {
    const trimmedName = `${this.form.value.deviceName ?? ''}`.trim();
    return trimmedName === this.data.currentName;
  }
}
