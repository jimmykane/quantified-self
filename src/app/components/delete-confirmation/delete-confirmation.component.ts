import { Component, inject, Optional } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'app-delete-confirmation',
  templateUrl: 'delete-confirmation.html',
  standalone: false
})
export class DeleteConfirmationComponent {
  private _bottomSheetRef = inject(MatBottomSheetRef, { optional: true });
  private _dialogRef = inject(MatDialogRef, { optional: true });

  shouldDelete(shouldDelete: boolean, event: Event): void {
    event.preventDefault();
    if (this._bottomSheetRef) {
      this._bottomSheetRef.dismiss(shouldDelete);
    }
    if (this._dialogRef) {
      this._dialogRef.close(shouldDelete);
    }
  }
}
