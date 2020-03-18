import { Directive, Input, OnInit } from '@angular/core';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { FileInterface } from './file.interface';
import { UPLOAD_STATUS } from './upload-status/upload.status';
import * as Sentry from '@sentry/browser';
import { UploadErrorComponent } from './upload-error/upload-error.component';
import { Logger } from 'ng2-logger';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatBottomSheet, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { UploadInfoComponent } from './upload-info/upload-info.component';
import { AppFilesStatusService } from '../../services/upload/app-files-status.service';
import { Overlay, RepositionScrollStrategy } from '@angular/cdk/overlay';


@Directive()
export abstract class UploadAbstractDirective implements OnInit {
  @Input() user: User;
  protected logger: Logger<any>;
  private uploadStatusBottomSheet: MatBottomSheetRef

  constructor(
    protected snackBar: MatSnackBar,
    protected dialog: MatDialog,
    protected bottomSheet: MatBottomSheet,
    protected filesStatusService: AppFilesStatusService,
    private overlay: Overlay,
    logger) {
    debugger;
    this.logger = logger;
  }


  ngOnInit(): void {
    if (!this.user) {
      throw new Error('This component can only be used with a user')
    }
  }

  async abstract processAndUploadFile(file: FileInterface);

  /**
   * This can be called multiple times as the user drops more files etc
   * @param event
   */
  async getFiles(event) {
    event.stopPropagation();
    event.preventDefault();

    if (!this.uploadStatusBottomSheet) {
      this.uploadStatusBottomSheet = this.bottomSheet.open(UploadInfoComponent, {
        disableClose: true,
        hasBackdrop: false,
        closeOnNavigation: false,
        scrollStrategy: this.overlay.scrollStrategies.reposition(),
      });
    }

    // Add as local to show totals
    const files = [];
    [...(event.target.files || event.dataTransfer.files)].forEach(file => {
      files.push(this.filesStatusService.addFile({
        file: file,
        name: file.name,
        status: UPLOAD_STATUS.PROCESSING,
        extension: file.name.split('.').pop().toLowerCase(),
        filename: file.name.split('.').shift(),
      }));
    })

    debugger
    // @todo no need to update the status on process file

    // please refactor

    // Then actually start processing them
    for (let index = 0; index < files.length; index++) {
      try {
        await this.processAndUploadFile(files[index]);
      } catch (e) {
        this.logger.error(e);
        Sentry.captureException(e);
      } finally {
        this.filesStatusService.updateFile(files[index]);
      }
    }

    // this.isUploadActive = false;
    this.snackBar.open('Processed ' + files.length + ' files', null, {
      duration: 2000,
    });

    // // If there is an error show a modal
    // if (this.files.filter(activityMetaData => activityMetaData.status === UPLOAD_STATUS.ERROR).length) {
    //   this.dialog.open(UploadErrorComponent, {
    //     width: '75vw',
    //     disableClose: false,
    //     data: {activitiesMetaData: this.files},
    //   });
    // }

    // Remove all;
    // this.files = [];
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
    this.uploadStatusBottomSheet.dismiss();
  }
}

