import {UntypedFormControl, UntypedFormGroup} from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';


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
  hasError(formGroup: any, field?: string) {
    if (!field) {
      return !formGroup.valid;
    }
    return !(formGroup.get(field).valid && formGroup.get(field).touched);
  }

  validateAllFormFields(formGroup: UntypedFormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      if (control instanceof UntypedFormControl) {
        control.markAsTouched({onlySelf: true});
      } else if (control instanceof UntypedFormGroup) {
        this.validateAllFormFields(control);
      }
    });
  }

  async onSubmit(event) {
    event.preventDefault();
  }

  async close(event) {
    event.stopPropagation();
    event.preventDefault();
    this.dialogRef.close();
  }

}
