import { Injectable } from '@angular/core';
import { FileInterface } from '../../components/upload/file.interface';
import { BehaviorSubject, Observable } from 'rxjs';
import { MatBottomSheet, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { Overlay } from '@angular/cdk/overlay';
import { UploadInfoComponent } from '../../components/upload/upload-info/upload-info.component';
import { UPLOAD_STATUS } from '../../components/upload/upload-status/upload.status';
import { MatDialog } from '@angular/material/dialog';
import { UploadErrorComponent } from '../../components/upload/upload-error/upload-error.component';

@Injectable({
  providedIn: 'root',
})
export class AppFilesStatusService {

  private files: FileInterface[] = [];
  private filesSubject: BehaviorSubject<FileInterface[]> = new BehaviorSubject([]);

  private bottomSheetRef: MatBottomSheetRef;

  constructor(
    private bottomSheet: MatBottomSheet,
    private dialog: MatDialog,
    private overlay: Overlay) {
  }


  public addFile(file: FileInterface): FileInterface {
    file.id = file.id || '_' + Math.random().toString(36).substr(2, 9);
    this.files.push(file);
    this.filesSubject.next(Object.assign([], this.files));
    this.openOrDismissBottomSheet();
    return file;
  }

  getFiles(): Observable<FileInterface[]> {
    return this.filesSubject.asObservable();
  }

  updateFile(file: FileInterface) {
    const index = this.files.findIndex(localFile => localFile.id === file.id);
    if (index === -1) {
      return
    }
    this.files[index] = file;
    this.openOrDismissBottomSheet();
    if (this.files.filter(localfile => localfile.status === UPLOAD_STATUS.PROCESSING).length === 0){
      this.files = [];
    }
    this.filesSubject.next(Object.assign([], this.files));
  }

  private openOrDismissBottomSheet(){
    // Open if not open
    if (!this.bottomSheetRef){
      this.bottomSheetRef = this.bottomSheet.open(UploadInfoComponent, {
        disableClose: true,
        hasBackdrop: false,
        closeOnNavigation: false,
        scrollStrategy: this.overlay.scrollStrategies.reposition(),
      });
      return;
    }
    // If we are not processing close and if there are errors also show the dialog
    if (this.files.filter(file => file.status === UPLOAD_STATUS.PROCESSING).length === 0 && this.bottomSheetRef){
      this.bottomSheetRef.dismiss()
      const errors = this.files.filter(activityMetaData => activityMetaData.status === UPLOAD_STATUS.ERROR);
      // // If there is an error show a modal
      if (errors.length) {
        this.dialog.open(UploadErrorComponent, {
          width: '75vw',
          disableClose: false,
          data: {files: this.files},
        });
      }
    }
  }

}
