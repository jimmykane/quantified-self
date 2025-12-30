import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, OnInit } from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib';
import { AppEventService } from '../../services/app.event.service';
import { FormBuilder, UntypedFormControl, UntypedFormGroup, FormGroupDirective, NgForm, Validators } from '@angular/forms';
import { ErrorStateMatcher } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LoggerService } from '../../services/logger.service';
import { Privacy } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';


@Component({
  selector: 'app-event-form',
  templateUrl: './event.form.component.html',
  styleUrls: ['./event.form.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})


export class EventFormComponent implements OnInit {

  public privacy = Privacy;
  public event: EventInterface;
  public user: User;
  public originalValues: {
    name: string;
  };

  public eventFormGroup: UntypedFormGroup;

  constructor(
    public dialogRef: MatDialogRef<EventFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private eventService: AppEventService,
    private snackBar: MatSnackBar,
    private logger: LoggerService,
  ) {
    this.event = data.event;
    this.user = data.user; // Perhaps move to service?
    if (!this.user || !this.event) {
      throw new Error('Component needs event and user')
    }
    this.originalValues = { name: this.event.name };
  }

  ngOnInit(): void {
    this.eventFormGroup = new UntypedFormGroup({
      // name: new FormControl(this.event.name, [
      //   Validators.required,
      //   // Validators.minLength(4),
      // ]),
      // description: new FormControl(this.event.description, [
      //   // Validators.required,
      //   // Validators.minLength(4),
      // ]),
      privacy: new UntypedFormControl(this.event.privacy, [
        Validators.required,
        // Validators.minLength(4),
      ]),
      isMerge: new UntypedFormControl(this.event.isMerge, [
        // Validators.required,
        // Validators.minLength(4),
      ]),
    });
  }

  hasError(field: string) {
    return !(this.eventFormGroup.get(field).valid && this.eventFormGroup.get(field).touched);
  }

  async onSubmit(event) {
    event.preventDefault();
    if (!this.eventFormGroup.valid) {
      this.validateAllFormFields(this.eventFormGroup);
      return;
    }
    try {
      await this.eventService.updateEventProperties(this.user, this.event.getID(), {
        // name: this.eventFormGroup.get('name').value,
        privacy: this.eventFormGroup.get('privacy').value,
        // description: this.eventFormGroup.get('description').value,
        isMerge: this.eventFormGroup.get('isMerge').value,
      });
      this.snackBar.open('Event saved', null, {
        duration: 2000,
      });
    } catch (e) {
      this.snackBar.open('Could not save event', null, {
        duration: 2000,
      });
      this.logger.error(e);
    } finally {
      this.dialogRef.close()
    }
  }

  validateAllFormFields(formGroup: UntypedFormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      if (control instanceof UntypedFormControl) {
        control.markAsTouched({ onlySelf: true });
      } else if (control instanceof UntypedFormGroup) {
        this.validateAllFormFields(control);
      }
    });
  }

  close(event) {
    event.stopPropagation();
    event.preventDefault();
    this.restoreOriginalValues();
    this.dialogRef.close();
  }

  restoreOriginalValues() {
    this.event.name = this.originalValues.name;
  }
}
