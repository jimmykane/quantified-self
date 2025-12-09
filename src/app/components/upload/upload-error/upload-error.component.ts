import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { UPLOAD_STATUS } from '../upload-status/upload.status';


@Component({
    selector: 'app-upload-error',
    templateUrl: './upload-error.component.html',
    styleUrls: ['./upload-error.component.css'],
    providers: [],
    standalone: false
})


export class UploadErrorComponent implements OnInit {

  public files = [];

  constructor(
    public dialogRef: MatDialogRef<UploadErrorComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
  ) {
    this.files = data.files.filter((file) => file.status === UPLOAD_STATUS.ERROR);
  }

  ngOnInit(): void {
  }

  close() {
    this.dialogRef.close();
  }
}
