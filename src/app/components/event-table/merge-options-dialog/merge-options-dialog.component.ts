import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';

export type MergeOption = 'benchmark' | 'multi';

@Component({
  selector: 'app-merge-options-dialog',
  templateUrl: './merge-options-dialog.component.html',
  styleUrls: ['./merge-options-dialog.component.css'],
  standalone: false
})
export class MergeOptionsDialogComponent {
  public selectedOption: MergeOption = 'benchmark';

  constructor(private dialogRef: MatDialogRef<MergeOptionsDialogComponent>) { }

  selectOption(option: MergeOption) {
    this.selectedOption = option;
  }

  confirm() {
    this.dialogRef.close({ mergeAsBenchmark: this.selectedOption === 'benchmark' });
  }

  cancel() {
    this.dialogRef.close(null);
  }
}
