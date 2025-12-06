import { Injectable, OnDestroy } from '@angular/core';
import { FileInterface } from '../../components/upload/file.interface';
import { Subscription } from 'rxjs';
import { MatBottomSheet, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { Overlay } from '@angular/cdk/overlay';
import { UploadInfoComponent } from '../../components/upload/upload-info/upload-info.component';
import { UPLOAD_STATUS } from '../../components/upload/upload-status/upload.status';
import { MatDialog } from '@angular/material/dialog';
import { UploadErrorComponent } from '../../components/upload/upload-error/upload-error.component';
import { AppFilesStatusService } from './app-files-status.service';

@Injectable({
  providedIn: 'root',
})
export class AppFilesInfoSheetService implements OnDestroy {

  private fileStatusSubsription: Subscription;

  private bottomSheetRef: MatBottomSheetRef;

  constructor(
    private filesStatusService: AppFilesStatusService,
    private bottomSheetService: MatBottomSheet,
    private dialog: MatDialog,
    private overlay: Overlay) {
    this.fileStatusSubsription = this.filesStatusService.getFiles().subscribe(files => {
      this.openOrDismissBottomSheet(files)
    });
  }

  ngOnDestroy(): void {
    if (this.fileStatusSubsription) {
      this.fileStatusSubsription.unsubscribe();
    }
  }

  private openOrDismissBottomSheet(files: FileInterface[]) {
    if (!files.length) {
      if (this.bottomSheetRef) {
        this.bottomSheetRef.dismiss();
        this.bottomSheetRef = null;
      }
      return;
    }

    // Open if not open
    if (!this.bottomSheetRef) {
      this.bottomSheetRef = this.bottomSheetService.open(UploadInfoComponent, {
        disableClose: true,
        hasBackdrop: false,
        closeOnNavigation: false,
        scrollStrategy: this.overlay.scrollStrategies.reposition(),
      });
      return;
    }
    // If we are not processing close and if there are errors also show the dialog
    if (files.filter(file => file.status === UPLOAD_STATUS.PROCESSING).length === 0 && this.bottomSheetRef) {
      const errors = files.filter(activityMetaData => activityMetaData.status === UPLOAD_STATUS.ERROR);
      // // If there is an error show a modal
      if (errors.length) {
        this.dialog.open(UploadErrorComponent, {
          width: '75vw',
          disableClose: false,
          data: { files: files },
        });
      }
    }
  }
}
