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

  @Input() user!: User;
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

  abstract processAndUploadFile(file: FileInterface): Promise<any>;

  /**
   * This can be called multiple times as the user drops more files etc
   * @param event
   */
  async getFiles(event: any) {
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
    // Size checks are handled in app.event.service.ts (after compression for text files)
    const filesToProcess = rawFiles.map(file => {
      const name = file.name;
      let extension = name.split('.').pop().toLowerCase();
      let filename = name.split('.').shift();
      if (extension === 'gz') {
        const parts = name.split('.');
        parts.pop(); // remove gz
        extension = parts.pop().toLowerCase();
        filename = parts.join('.');
      }
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
    let successfulUploads = 0;
    let failedUploads = 0;
    try {
      for (const fileItem of filesToProcess) {
        this.processingService.updateJob(fileItem.jobId, { status: 'processing', progress: 0 });
        try {
          await this.processAndUploadFile(fileItem);
          this.processingService.completeJob(fileItem.jobId);
          successfulUploads++;
        } catch (e: any) {
          this.logger.error(e);
          this.processingService.failJob(fileItem.jobId, e.message || 'Upload failed');
          failedUploads++;
        }
      }
    } finally {
      this.isUploading = false;
    }

    const message = `Processed ${filesToProcess.length} files: ${successfulUploads} successful, ${failedUploads} failed`;
    this.snackBar.open(message, 'OK', {
      duration: 5000,
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

