import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface ErrorDialogData {
    title: string;
    message: string;
}

@Component({
    selector: 'app-error-dialog',
    template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p>{{ data.message }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close color="primary">OK</button>
    </mat-dialog-actions>
  `,
    styles: [`
    h2 { color: #f44336; } /* Red for error */
    mat-dialog-content { font-size: 16px; margin-bottom: 10px; }
  `],
    standalone: false
})
export class ErrorDialogComponent {
    constructor(
        public dialogRef: MatDialogRef<ErrorDialogComponent>,
        @Inject(MAT_DIALOG_DATA) public data: ErrorDialogData
    ) { }
}
