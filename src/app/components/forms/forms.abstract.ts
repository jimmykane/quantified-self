import {
  ChangeDetectorRef,
  Inject,
  OnDestroy,
} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogRef, MatSnackBar} from '@angular/material';
import {FormControl, FormGroup} from '@angular/forms';


/**
 * @todo move all forms to here
 */
export abstract class FormsAbstract {

  constructor(
    public dialogRef: MatDialogRef<any>,
    public data: any,
    protected snackBar?: MatSnackBar,
  ) {

  }


  // @todo extract to abstract for all forms

  hasError(formGroup: FormGroup, field?: string) {
    if (!field) {
      return !formGroup.valid;
    }
    return !(formGroup.get(field).valid && formGroup.get(field).touched);
  }

  validateAllFormFields(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      if (control instanceof FormControl) {
        control.markAsTouched({onlySelf: true});
      } else if (control instanceof FormGroup) {
        this.validateAllFormFields(control);
      }
    });
  }


  close(event) {
    event.stopPropagation();
    event.preventDefault();
    this.dialogRef.close();
  }

}
