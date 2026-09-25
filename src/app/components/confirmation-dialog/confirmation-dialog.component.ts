import { Component, inject } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { AppHapticsService } from '../../services/app.haptics.service';

export interface ConfirmationDialogData {
  title?: string;
  message?: string;
  htmlMessage?: string;
  confirmText?: string;
  cancelText?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: 'primary' | 'accent' | 'warn';
  showCancel?: boolean;
  pastProviderCleanupOption?: boolean;
}

export interface ConfirmationWithPastProviderCleanup {
  confirmed: true;
  removePastProviderCopies: boolean;
}

@Component({
  selector: 'app-confirmation-dialog',
  templateUrl: './confirmation-dialog.component.html',
  styleUrls: ['./confirmation-dialog.component.scss'],
  standalone: false
})
export class ConfirmationDialogComponent {
  private _bottomSheetRef = inject(MatBottomSheetRef, { optional: true });
  private _dialogRef = inject(MatDialogRef, { optional: true });
  private _dialogData = inject<ConfirmationDialogData | null>(MAT_DIALOG_DATA, { optional: true });
  private _hapticsService = inject(AppHapticsService);
  removePastProviderCopies = false;

  get pastProviderCleanupOption(): boolean {
    return this._dialogData?.pastProviderCleanupOption === true;
  }

  onPastProviderCleanupChange(checked: boolean): void {
    this.removePastProviderCopies = checked;
    this._hapticsService.selection();
  }

  get title(): string {
    return this._dialogData?.title || 'Are you sure?';
  }

  get message(): string {
    return this._dialogData?.message || 'This action cannot be undone.';
  }

  get htmlMessage(): string | null {
    return this._dialogData?.htmlMessage || null;
  }

  get confirmButtonText(): string {
    return this._dialogData?.confirmLabel || this._dialogData?.confirmText || 'Confirm';
  }

  get cancelButtonText(): string {
    return this._dialogData?.cancelLabel || this._dialogData?.cancelText || 'Cancel';
  }

  get confirmColor(): 'primary' | 'accent' | 'warn' {
    return this._dialogData?.confirmColor || 'primary';
  }

  get showCancel(): boolean {
    if (this._dialogData?.showCancel === false) {
      return false;
    }
    return true;
  }

  onCancel(): void {
    this._hapticsService.selection();
    this.respond(false);
  }

  onConfirm(): void {
    if (this.confirmColor === 'warn') {
      this._hapticsService.warning();
    } else {
      this._hapticsService.selection();
    }
    this.respond(this.pastProviderCleanupOption
      ? { confirmed: true, removePastProviderCopies: this.removePastProviderCopies } : true);
  }

  private respond(confirmed: boolean | ConfirmationWithPastProviderCleanup): void {
    if (this._bottomSheetRef) {
      this._bottomSheetRef.dismiss(confirmed);
    }
    if (this._dialogRef) {
      this._dialogRef.close(confirmed);
    }
  }
}
