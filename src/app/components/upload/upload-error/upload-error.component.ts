import {ChangeDetectionStrategy, Component, Inject, Input, OnInit} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import {UPLOAD_STATUS} from "../upload-status/upload.status";


@Component({
  selector: 'app-upload-error',
  templateUrl: './upload-error.component.html',
  styleUrls: ['./upload-error.component.css'],
  providers: [],
  // changeDetection: ChangeDetectionStrategy.OnPush,
})


export class UploadErrorComponent implements OnInit {

  public activitiesMetaData = [];

  constructor(
    public dialogRef: MatDialogRef<UploadErrorComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
  ) {
    this.activitiesMetaData = data.activitiesMetaData.filter((activityMetadata) => {return activityMetadata.status === UPLOAD_STATUS.ERROR;});
  }

  ngOnInit(): void {
  }

  close() {
    this.dialogRef.close();
  }
}
