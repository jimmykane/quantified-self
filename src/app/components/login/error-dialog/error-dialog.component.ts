import { Component, Inject, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { AppHapticsService } from '../../../services/app.haptics.service';

export interface ErrorDialogData {
  title: string;
  message: string;
}

@Component({
  selector: 'app-error-dialog',
  templateUrl: './error-dialog.component.html',
  styleUrls: ['./error-dialog.component.scss'],
  standalone: false,
})
export class ErrorDialogComponent {
  private readonly haptics = inject(AppHapticsService);

  constructor(
    public dialogRef: MatDialogRef<ErrorDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ErrorDialogData,
  ) { }

  close(): void {
    this.haptics.selection();
    this.dialogRef.close();
  }
}
