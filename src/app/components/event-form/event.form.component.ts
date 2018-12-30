import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, OnInit} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventService} from '../../services/app.event.service';
import {FormBuilder, FormControl, FormGroup, FormGroupDirective, NgForm, Validators} from '@angular/forms';
import {ErrorStateMatcher, MAT_DIALOG_DATA, MatDialogRef, MatSnackBar} from '@angular/material';
import * as Raven from 'raven-js';
import {AppUser} from '../../authentication/app.auth.service';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';


@Component({
  selector: 'app-event-form',
  templateUrl: './event.form.component.html',
  styleUrls: ['./event.form.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})


export class EventFormComponent implements OnInit {

  public privacy = Privacy;
  public event: EventInterface;
  public user: AppUser;
  public originalValues: {
    name: string;
  };

  public eventFormGroup: FormGroup;

  constructor(
    public dialogRef: MatDialogRef<EventFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private eventService: EventService,
    private snackBar: MatSnackBar,
    private formBuilder: FormBuilder,
  ) {
    this.event = data.event;
    this.user = data.user; // Perhaps move to service?
    if (!this.user || !this.event) {
      throw  'Component needs event and user'
    }
    this.originalValues = {name: this.event.name};
  }

  ngOnInit(): void {
    this.eventFormGroup = new FormGroup({
      name: new FormControl(this.event.name, [
        Validators.required,
        // Validators.minLength(4),
      ]),
      privacy: new FormControl(this.event.privacy, [
        Validators.required,
        // Validators.minLength(4),
      ]),
      // 'alterEgo': new FormControl(this.hero.alterEgo),
      // 'power': new FormControl(this.hero.power, Validators.required)
    });
  }

  hasError(field: string) {
    return !(this.eventFormGroup.get(field).valid && this.eventFormGroup.get(field).touched);
  }

  async onSubmit() {
    if (!this.eventFormGroup.valid) {
      this.validateAllFormFields(this.eventFormGroup);
      return;
    }
    try {
      await this.eventService.updateEventProperties(this.user, this.event.getID(), {
        name: this.eventFormGroup.get('name').value,
        privacy: this.eventFormGroup.get('privacy').value,
      });
      this.snackBar.open('Event saved', null, {
        duration: 5000,
      });
    } catch (e) {
      this.snackBar.open('Could not save event', null, {
        duration: 5000,
      });
      Raven.captureException(e);
    } finally {
      this.dialogRef.close()
    }
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

  close() {
    this.restoreOriginalValues();
    this.dialogRef.close();
  }

  restoreOriginalValues() {
    this.event.name = this.originalValues.name;
  }
}
