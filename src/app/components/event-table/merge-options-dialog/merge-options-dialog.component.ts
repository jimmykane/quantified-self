import { Component, inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { EventEmitter } from '@angular/core';
import { AppHapticsService } from '../../../services/app.haptics.service';

export type MergeOption = 'benchmark' | 'multi';

@Component({
  selector: 'app-merge-options-dialog',
  templateUrl: './merge-options-dialog.component.html',
  styleUrls: ['./merge-options-dialog.component.scss'],
  standalone: false
})
export class MergeOptionsDialogComponent {
  private readonly haptics = inject(AppHapticsService);
  public selectedOption: MergeOption = 'benchmark';
  public isMerging = false;
  public mergeRequested = new EventEmitter<MergeOption>();

  constructor(private dialogRef: MatDialogRef<MergeOptionsDialogComponent>) { }

  selectOption(option: MergeOption) {
    if (this.isMerging || option === this.selectedOption) return;
    this.selectedOption = option;
    this.haptics.selection();
  }

  confirm() {
    if (this.isMerging) {
      return;
    }
    this.isMerging = true;
    this.haptics.selection();
    this.mergeRequested.emit(this.selectedOption);
  }

  cancel() {
    if (this.isMerging) {
      return;
    }
    this.haptics.selection();
    this.dialogRef.close(null);
  }
}
