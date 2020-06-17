import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, OnInit} from '@angular/core';
import {EventInterface} from '@sports-alliance/sports-lib/lib/events/event.interface';
import {AppEventService} from '../../services/app.event.service';
import {FormBuilder, FormControl, FormGroup, FormGroupDirective, NgForm, Validators} from '@angular/forms';
import {ErrorStateMatcher} from '@angular/material/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import {Privacy} from '@sports-alliance/sports-lib/lib/privacy/privacy.class.interface';
import {User} from '@sports-alliance/sports-lib/lib/users/user';
import { AppUserService } from '../../services/app.user.service';


@Component({
  selector: 'app-event-form',
  templateUrl: './promo-dialog.component.html',
  styleUrls: ['./promo-dialog.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})


export class PromoDialogComponent implements OnInit {

  public user: User;

  public eventFormGroup: FormGroup;

  constructor(
    public dialogRef: MatDialogRef<PromoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) private data: any,
    private userService: AppUserService,
    private snackBar: MatSnackBar,
  ) {
    this.user = data.user; // Perhaps move to service?
  }

  ngOnInit(): void {
    // @todo enable this
    // this.userService.setLastSeenPromoToNow(this.user);
  }


  close(event) {
    event.stopPropagation();
    event.preventDefault();
    this.dialogRef.close();
  }

}
