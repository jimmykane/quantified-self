import { Component, OnInit, Input, Inject, OnDestroy, ChangeDetectorRef } from '@angular/core';
import {UPLOAD_STATUS} from '../upload-status/upload.status';
import { MAT_BOTTOM_SHEET_DATA } from '@angular/material/bottom-sheet';
import { FileInterface } from '../file.interface';
import { AppFilesStatusService } from '../../../services/upload/app-files-status.service';
import { Subscription } from 'rxjs';

/**
 * Component responsible for displaying a progresbar
 * until the activity has finished being processed
 */
@Component({
  selector: 'app-upload-info',
  templateUrl: './upload-info.component.html',
  styleUrls: ['./upload-info.component.css']
})
export class UploadInfoComponent implements OnInit, OnDestroy {

  public files: FileInterface[] = [];
  private fileStatusSubsription: Subscription;

  constructor(private fileStatusService: AppFilesStatusService, private changeDetectorRef: ChangeDetectorRef) {
    this.fileStatusSubsription = this.fileStatusService.getFiles().subscribe(files => {
      this.files = files||[];
      this.changeDetectorRef.markForCheck();
    })
  }

  getOverallProgress() {
    return this.getProcessedFiles().length ? 100 * this.getProcessedFiles().length / this.files.length : 0;
  }

  getProcessedFiles() {
    return this.files.filter((file) => {
      return file.status !== UPLOAD_STATUS.PROCESSING;
    })
  }

  getFilesBeingProcessed() {
    return this.files.filter((file) => {
      return file.status === UPLOAD_STATUS.PROCESSING;
    })
  }


  getFailedActivities() {
    return this.files.filter((file) => {
      return file.status === UPLOAD_STATUS.ERROR;
    })
  }

  ngOnInit() {
  }

  ngOnDestroy(): void {
    if (this.fileStatusSubsription){
      this.fileStatusSubsription.unsubscribe()
    }
  }
}
