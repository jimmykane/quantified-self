import {Component} from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';

@Component({
    selector: 'app-delete-confirmation',
    templateUrl: 'delete-confirmation.html',
    standalone: false
})
export class DeleteConfirmationComponent {
  constructor(private _bottomSheetRef: MatBottomSheetRef<DeleteConfirmationComponent>) {}

  shouldDelete(shouldDelete, event): void {
    event.preventDefault();
    this._bottomSheetRef.dismiss(shouldDelete);
  }
}
