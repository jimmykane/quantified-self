import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Inject,
  Input,
  OnInit
} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {FormBuilder, FormControl, FormGroup, FormGroupDirective, NgForm, Validators} from '@angular/forms';
import {ErrorStateMatcher} from '@angular/material/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import {WindowService} from '../../../services/app.window.service';
import {AngularFireAuth} from '@angular/fire/auth';
import * as firebase from 'firebase/app';


@Component({
  selector: 'app-phone-form',
  templateUrl: './phone.form.component.html',
  styleUrls: ['./phone.form.component.css'],
  providers: [],
})


export class PhoneFormComponent implements OnInit, AfterViewInit {

  windowRef: any;

  phoneNumber: string;

  verificationCode: string;

  user: any;
  public eventFormGroup: FormGroup;

  constructor(
    public dialogRef: MatDialogRef<PhoneFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private snackBar: MatSnackBar,
    private windowService: WindowService,
    private afAuth: AngularFireAuth,
  ) {
  }

  ngAfterViewInit(): void {
    this.windowRef.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container')
    this.windowRef.recaptchaVerifier
      .render()
      .then( widgetId => {
        this.windowRef.recaptchaWidgetId = widgetId
      });
  }

  ngOnInit(): void {
    this.windowRef = this.windowService.windowRef;
  }

  sendLoginCode() {
    this.afAuth.auth
      .signInWithPhoneNumber(this.phoneNumber, this.windowRef.recaptchaVerifier)
      .then(result => {
        this.windowRef.confirmationResult = result;
      })
      .catch( error => {
        this.snackBar.open(`Could not login due to ${error.message}`, null, {
          duration: 2000,
        });
        console.log(error)
      });
  }

  verifyLoginCode() {
    this.windowRef.confirmationResult
      .confirm(this.verificationCode)
      .then( result => {
        this.user = result.user;
        this.dialogRef.close({user: this.user});
      })
      .catch( error => console.log(error, 'Incorrect code entered?'));
  }


  // close(event) {
  //   event.stopPropagation();
  //   event.preventDefault();
  //   this.dialogRef.close({user: this.user});
  // }


}
