import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, OnInit} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';
import {FormBuilder, FormControl, FormGroup, FormGroupDirective, NgForm, Validators} from '@angular/forms';
import {ErrorStateMatcher, MAT_DIALOG_DATA, MatDialogRef, MatSnackBar} from '@angular/material';
import * as Raven from 'raven-js';
import {UPLOAD_STATUS} from '../upload/upload.component';


@Component({
  selector: 'app-upload-error',
  templateUrl: './upload-error.component.html',
  styleUrls: ['./upload-error.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})


export class UploadErrorComponent implements OnInit {

  public activitiesMetaData = [];

  constructor(
    public dialogRef: MatDialogRef<UploadErrorComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private eventService: EventService,
    private snackBar: MatSnackBar,
    private formBuilder: FormBuilder,
  ) {
    this.activitiesMetaData = data.activitiesMetaData;
  }

  ngOnInit(): void {
  }

  close() {
    this.dialogRef.close();
  }

  // @todo move this to service
  reset() {
    localStorage.clear();
    window.location.reload();
  }
}
