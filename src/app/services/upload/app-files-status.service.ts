import { Injectable } from '@angular/core';
import { FileInterface } from '../../components/upload/file.interface';
import { BehaviorSubject, Observable } from 'rxjs';
import { MatBottomSheet, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { Overlay } from '@angular/cdk/overlay';
import { UploadInfoComponent } from '../../components/upload/upload-info/upload-info.component';
import { UPLOAD_STATUS } from '../../components/upload/upload-status/upload.status';

@Injectable({
  providedIn: 'root',
})
export class AppFilesStatusService {

  private files: FileInterface[] = [];
  private filesSubject: BehaviorSubject<FileInterface[]> = new BehaviorSubject([]);

  private bottomSheetRef: MatBottomSheetRef;

  constructor(
    protected bottomSheet: MatBottomSheet,
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
    this.filesSubject.next(Object.assign([], this.files));
    this.openOrDismissBottomSheet();
  }

  private openOrDismissBottomSheet(){
    if (!this.bottomSheetRef){
      this.bottomSheetRef = this.bottomSheet.open(UploadInfoComponent, {
        disableClose: true,
        hasBackdrop: false,
        closeOnNavigation: false,
        scrollStrategy: this.overlay.scrollStrategies.reposition(),
      });
      return;
    }
    if (this.files.filter(file => file.status === UPLOAD_STATUS.PROCESSING).length === 0 && this.bottomSheetRef){
      this.bottomSheetRef.dismiss()
    }
  }

}
