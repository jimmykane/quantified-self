import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ValidationErrors, ValidatorFn } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { normalizeRouteName, ROUTE_NAME_MAX_LENGTH } from '../../../helpers/route-name.helper';
import { SharedModule } from '../../../modules/shared.module';

export interface RouteNameDialogData {
  currentName: string;
}

@Component({
  selector: 'app-route-name-dialog',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './route-name-dialog.component.html',
  styleUrls: ['./route-name-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RouteNameDialogComponent {
  private formBuilder = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<RouteNameDialogComponent, string | undefined>);
  readonly data = inject<RouteNameDialogData>(MAT_DIALOG_DATA);

  readonly maxLength = ROUTE_NAME_MAX_LENGTH;
  readonly currentName = normalizeRouteName(this.data.currentName);
  readonly form = this.formBuilder.nonNullable.group({
    routeName: [
      this.currentName,
      [this.trimmedRequired(), this.trimmedMaxLength()],
    ],
  });
  readonly routeNameControl = this.form.controls.routeName;

  close(): void {
    this.dialogRef.close();
  }

  save(): void {
    if (!this.form.valid) {
      this.form.markAllAsTouched();
      return;
    }

    const routeName = normalizeRouteName(this.routeNameControl.value);
    if (!routeName || routeName === this.currentName) {
      return;
    }

    this.dialogRef.close(routeName);
  }

  get isUnchanged(): boolean {
    return normalizeRouteName(this.routeNameControl.value) === this.currentName;
  }

  private trimmedRequired(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null =>
      normalizeRouteName(control.value) ? null : { required: true };
  }

  private trimmedMaxLength(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const routeNameLength = normalizeRouteName(control.value).length;
      return routeNameLength <= this.maxLength
        ? null
        : {
          maxlength: {
            requiredLength: this.maxLength,
            actualLength: routeNameLength,
          },
        };
    };
  }
}
