import {Component} from '@angular/core';
import {MatBottomSheetRef} from '@angular/material';

@Component({
  selector: 'app-delete-confirmation',
  templateUrl: 'delete-confirmation.html',
})
export class DeleteConfirmationComponent {
  constructor(private _bottomSheetRef: MatBottomSheetRef<DeleteConfirmationComponent>) {}

  shouldDelete(shouldDelete): void {
    this._bottomSheetRef.dismiss(shouldDelete);
    event.preventDefault();
  }
}
