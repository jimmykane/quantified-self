import { Directive, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { User } from '@sports-alliance/sports-lib';
import { FileInterface } from './file.interface';
import { UPLOAD_STATUS } from './upload-status/upload.status';
import { LoggerService } from '../../services/logger.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { AppProcessingService } from '../../services/app.processing.service';


@Directive()
export abstract class UploadAbstractDirective implements OnInit {

  @Input() user: User;
  @Input() hasProAccess: boolean = false;
  @Input() requiresPro: boolean = false;
  public isUploading = false;

  constructor(
    protected snackBar: MatSnackBar,
    protected dialog: MatDialog,
    protected processingService: AppProcessingService,
    protected router: Router,
    protected logger: LoggerService) {

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
    event.stopPropagation();
    event.preventDefault();

    if (this.requiresPro && !this.hasProAccess) {
      const snackBarRef = this.snackBar.open('This feature is available for Pro users.', 'UPGRADE', {
        duration: 5000,
      });
      snackBarRef.onAction().subscribe(() => {
        this.router.navigate(['/settings']);
      });
      return;
    }

    const rawFiles = [...(event.target.files || event.dataTransfer.files)];
    // Add as local to show totals
    const filesToProcess = rawFiles.filter(file => {
      // 10MB limit
      if (file.size > 10 * 1024 * 1024) {
        this.snackBar.open(`File ${file.name} is too large. Maximum size is 10MB.`, 'OK', {
          duration: 5000,
        });
        return false;
      }
      return true;
    }).map(file => {
      const name = file.name;
      const extension = name.split('.').pop().toLowerCase();
      const filename = name.split('.').shift();
      const jobId = this.processingService.addJob('upload', `Uploading ${name}...`);

      return {
        file,
        name,
        extension,
        filename,
        jobId,
        status: UPLOAD_STATUS.PROCESSING
      }
    });

    if (filesToProcess.length === 0 && rawFiles.length > 0) {
      this.isUploading = false;
      // Clear the target
      event.target.value = '';
      return;
    }

    // Then actually start processing them
    this.isUploading = true;
    try {
      for (const fileItem of filesToProcess) {
        this.processingService.updateJob(fileItem.jobId, { status: 'processing', progress: 0 });
        try {
          await this.processAndUploadFile(fileItem);
          this.processingService.completeJob(fileItem.jobId);
        } catch (e) {
          this.logger.error(e);
          this.processingService.failJob(fileItem.jobId, e.message || 'Upload failed');
        }
      }
    } finally {
      this.isUploading = false;
    }

    // this.isUploadActive = false;
    this.snackBar.open('Processed ' + filesToProcess.length + ' files', null, {
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

