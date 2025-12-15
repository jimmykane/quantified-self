import { Directive, Input, OnInit } from '@angular/core';
import { User } from '@sports-alliance/sports-lib';
import { FileInterface } from './file.interface';
import { UPLOAD_STATUS } from './upload-status/upload.status';
import * as Sentry from '@sentry/browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { AppFilesStatusService } from '../../services/upload/app-files-status.service';


@Directive()
export abstract class UploadAbstractDirective implements OnInit {

  @Input() user: User;

  constructor(
    protected snackBar: MatSnackBar,
    protected dialog: MatDialog,
    protected filesStatusService: AppFilesStatusService) {

  }


  ngOnInit(): void {
    if (!this.user) {
      throw new Error('This component can only be used with a user')
    }
  }

  abstract processAndUploadFile(file: FileInterface);

  /**
   * This can be called multiple times as the user drops more files etc
   * @param event
   */
  async getFiles(event) {
    event.stopPropagation();
    event.preventDefault();

    // Add as local to show totals
    const files = [];
    [...(event.target.files || event.dataTransfer.files)].forEach(file => {
      files.push(this.filesStatusService.addOrUpdate({
        file: file,
        name: file.name,
        status: UPLOAD_STATUS.PROCESSING,
        extension: file.name.split('.').pop().toLowerCase(),
        filename: file.name.split('.').shift(),
      }));
    })

    // Then actually start processing them
    for (let index = 0; index < files.length; index++) {
      try {
        await this.processAndUploadFile(files[index]);
        files[index].status = UPLOAD_STATUS.PROCESSED;
      } catch (e) {
        files[index].status = UPLOAD_STATUS.ERROR;

        Sentry.captureException(e);
      } finally {
        this.filesStatusService.addOrUpdate(files[index]);
      }
    }

    // this.isUploadActive = false;
    this.snackBar.open('Processed ' + files.length + ' files', null, {
      duration: 2000,
    });

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

