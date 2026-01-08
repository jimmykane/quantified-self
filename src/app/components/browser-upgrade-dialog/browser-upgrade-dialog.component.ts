import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
    selector: 'app-browser-upgrade-dialog',
    standalone: true,
    imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
    template: `
    <h2 mat-dialog-title class="display-flex align-center">
      <mat-icon color="warn" class="margin-right-8">warning</mat-icon>
      Browser Upgrade Required
    </h2>
    <mat-dialog-content>
      <p>Your browser does not support modern compression features required for this action.</p>
      <p>Please upgrade to a modern version of <strong>Chrome, Firefox, Safari, or Edge</strong> to continue.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Close</button>
      <a mat-flat-button color="primary" href="https://browsehappy.com/" target="_blank">Learn More</a>
    </mat-dialog-actions>
  `,
    styles: [`
    .display-flex { display: flex; }
    .align-center { align-items: center; }
    .margin-right-8 { margin-right: 8px; }
  `]
})
export class BrowserUpgradeDialogComponent {
    constructor(public dialogRef: MatDialogRef<BrowserUpgradeDialogComponent>) { }
}
