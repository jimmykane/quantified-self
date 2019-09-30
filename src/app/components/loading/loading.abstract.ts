import {
  ChangeDetectorRef,
  Inject,
  OnDestroy,
} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogRef, MatSnackBar} from '@angular/material';
import {FormControl, FormGroup} from '@angular/forms';
import {UnitBasedAbstract} from '../unit-based/unit-based.abstract';

/**
 * Class for handling loading with no change detection
 */
export abstract class LoadingAbstract extends UnitBasedAbstract {

  public isLoading: boolean;

  constructor(private  changeDetector: ChangeDetectorRef) {
    super();
  }

  public loading() {
    this.isLoading = true;
    this.changeDetector.detectChanges();
  }

  public loaded() {
    this.isLoading = false;
    this.changeDetector.detectChanges();
  }
}
