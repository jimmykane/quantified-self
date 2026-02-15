import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { EventEmitter } from '@angular/core';

export type MergeOption = 'benchmark' | 'multi';

@Component({
  selector: 'app-merge-options-dialog',
  templateUrl: './merge-options-dialog.component.html',
  styleUrls: ['./merge-options-dialog.component.scss'],
  standalone: false
})
export class MergeOptionsDialogComponent {
  public selectedOption: MergeOption = 'benchmark';
  public isMerging = false;
  public mergeRequested = new EventEmitter<MergeOption>();

  constructor(private dialogRef: MatDialogRef<MergeOptionsDialogComponent>) { }

  selectOption(option: MergeOption) {
    this.selectedOption = option;
  }

  confirm() {
    if (this.isMerging) {
      return;
    }
    this.isMerging = true;
    this.mergeRequested.emit(this.selectedOption);
  }

  cancel() {
    if (this.isMerging) {
      return;
    }
    this.dialogRef.close(null);
  }
}
