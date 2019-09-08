import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Inject,
  Input, OnDestroy,
  OnInit
} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {
  FormControl,
  FormGroup,
  NgForm,
  Validators
} from '@angular/forms';
import {ErrorStateMatcher} from '@angular/material/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import {AngularFireAuth} from '@angular/fire/auth';
import * as firebase from 'firebase/app';
import {FormsAbstract} from '../forms/forms.abstract';


@Component({
  selector: 'app-phone-form',
  templateUrl: './events-export.form.component.html',
  styleUrls: ['./events-export.form.component.css'],
  providers: [],
})


export class EventsExportFormComponent extends FormsAbstract{


}
