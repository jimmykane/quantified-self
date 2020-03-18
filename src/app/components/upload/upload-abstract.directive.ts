import { Directive, Input, OnInit } from '@angular/core';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { FileInterface } from './file.interface';
import { UPLOAD_STATUS } from './upload-status/upload.status';
import * as Sentry from '@sentry/browser';
import { UploadErrorComponent } from './upload-error/upload-error.component';
import { Logger } from 'ng2-logger';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';


@Directive()
export abstract class UploadAbstractDirective implements OnInit {
  @Input() user: User;

  public isUploadActive = false;
  public filesMetaData: FileInterface[] = [];
  protected logger: Logger<any>

  constructor(
    protected snackBar: MatSnackBar,
    protected dialog: MatDialog,
    logger) {
    this.logger = logger;
  }


  ngOnInit(): void {
    if (!this.user) {
      throw new Error('This component can only be used with a user')
    }
  }

  async abstract processAndUploadFile(file: FileInterface);

  async getFiles(event) {
    event.stopPropagation();
    event.preventDefault();

    this.isUploadActive = true;
    const files = event.target.files || event.dataTransfer.files;

    // First create the metadata on a single loop so subcomponents can get updated
    for (let index = 0; index < files.length; index++) {
      this.filesMetaData.push({
        file: files[index],
        name: files[index].name,
        status: UPLOAD_STATUS.PROCESSING,
        extension: files[index].name.split('.').pop().toLowerCase(),
        filename: files[index].name.split('.').shift(),
      });
    }

    // Then actually start processing them
    for (let index = 0; index < this.filesMetaData.length; index++) {
      try {
        await this.processAndUploadFile(this.filesMetaData[index]);
      } catch (e) {
        this.logger.error(e);
        Sentry.captureException(e);
      }
    }

    this.isUploadActive = false;
    this.snackBar.open('Processed ' + this.filesMetaData.length + ' files', null, {
      duration: 2000,
    });

    // If there is an error show a modal
    if (this.filesMetaData.filter(activityMetaData => activityMetaData.status === UPLOAD_STATUS.ERROR).length) {
      const dialogRef = this.dialog.open(UploadErrorComponent, {
        width: '75vw',
        disableClose: false,
        data: {activitiesMetaData: this.filesMetaData},
      });
      // dialogRef.afterClosed().subscribe(result => {
      //   console.log('The dialog was closed');
      // });
    }

    // Remove all;
    this.filesMetaData = [];
    // Pass event to removeDragData for cleanup
    if (event.dataTransfer && event.dataTransfer.items) {
      // Use DataTransferItemList interface to remove the drag data
      event.dataTransfer.items.clear();
    } else if (event.dataTransfer) {
      // Use DataTransfer interface to remove the drag data
      event.dataTransfer.clearData();
    }
    // Clear the target
    event.target.value = '';
  }
}

