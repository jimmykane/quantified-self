import { Component, inject, Input } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LoggerService } from '../../../services/logger.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { environment } from '../../../../environments/environment';
import { Auth, getIdToken } from 'app/firebase/auth';
import { UploadAbstractDirective } from '../upload-abstract.directive';
import { FileInterface } from '../file.interface';
import { AppProcessingService } from '../../../services/app.processing.service';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getSize } from '@sports-alliance/sports-lib';
import { BrowserCompatibilityService } from '../../../services/browser.compatibility.service';
import { AppFunctionsService } from '../../../services/app.functions.service';

const MAX_WAHOO_ROUTE_UPLOAD_BYTES = 20 * 1024 * 1024;
const BASE64_CHUNK_SIZE = 0x8000;


@Component({
  selector: 'app-upload-route-to-service',
  templateUrl: './upload-routes-to-service.component.html',
  styleUrls: ['../upload-abstract.css', './upload-routes-to-service.component.css'],
  standalone: false
})

export class UploadRoutesToServiceComponent extends UploadAbstractDirective {
  private analyticsService = inject(AppAnalyticsService);
  private auth = inject(Auth);
  private compatibilityService = inject(BrowserCompatibilityService);

  private functionsService = inject(AppFunctionsService);

  public data: any = inject(MAT_DIALOG_DATA, { optional: true });
  public dialogRef = inject(MatDialogRef<UploadRoutesToServiceComponent>, { optional: true });

  private _serviceName: ServiceNames = ServiceNames.SuuntoApp;

  @Input() set serviceName(value: ServiceNames) {
    this._serviceName = value || ServiceNames.SuuntoApp;
  }

  get serviceName(): ServiceNames {
    return this._serviceName;
  }

  get acceptsFitRoutes(): boolean {
    return this.serviceName === ServiceNames.WahooAPI;
  }

  get fileAccept(): string {
    return this.acceptsFitRoutes ? '.fit' : '.gpx';
  }

  get uploadPrompt(): string {
    return this.acceptsFitRoutes ? 'Open or drag and drop FIT route files' : 'Open or drag and drop GPX route files';
  }

  constructor() {
    super();
    if (this.data?.serviceName) {
      this.serviceName = this.data.serviceName;
    }
  }

  async processAndUploadFile(file: FileInterface) {
    this.analyticsService.logEvent('upload_route_to_service', { service: this.serviceName });
    if (this.acceptsFitRoutes) {
      return this.processAndUploadWahooFitRoute(file);
    }

    return new Promise((resolve, reject) => {
      const fileReader = new FileReader();
      fileReader.onload = async () => {
        if (!(typeof fileReader.result === 'string')) {
          reject(`Not a GPX file`)
          return;
        }

        if (!this.auth.currentUser) {
          reject('User not logged in');
          return;
        }

        const idToken = await getIdToken(this.auth.currentUser, true);
        let compressedBuffer: ArrayBuffer;

        try {
          // Check for native support
          if (!this.compatibilityService.checkCompressionSupport()) {
            reject('Unsupported browser');
            return;
          }

          const stream = new Blob([fileReader.result as string]).stream();
          const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
          compressedBuffer = await new Response(compressedStream).arrayBuffer();

          if (compressedBuffer.byteLength > 10485760) {
            throw new Error(`Cannot upload route because the size is greater than 10MB`);
          }
        } catch (e: any) {
          this.logger.error(e);
          const errorMessage = e.message || 'Compression failed';
          this.snackBar.open(`Could not process ${file.filename}.${file.extension}, reason: ${errorMessage} `, 'OK', { duration: 10000 });
          reject(e);
          return;
        }


        // Convert compressed ArrayBuffer to Base64
        const base64String = btoa(new Uint8Array(compressedBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

        if (file.jobId) {
          this.processingService.updateJob(file.jobId, { progress: 50 });
        }

        this.functionsService.call<any, { status: string }>(
          'importRouteToSuuntoApp',
          { file: base64String }
        ).then(() => {
          if (file.jobId) {
            this.processingService.updateJob(file.jobId, { progress: 100 });
          }
          resolve(true);
        }).catch((e) => {
          this.logger.error(e);
          const errorMessage = e.message || 'Unknown error';
          this.snackBar.open(`Could not upload ${file.filename}.${file.extension}, reason: ${errorMessage} `, 'OK', { duration: 10000 });
          reject(e);
        });
      }

      // Read it depending on the extension
      if (file.extension === 'gpx') {
        fileReader.readAsText(file.file);
      } else {
        reject('Unknown file type');
      }
    })
  }

  private async processAndUploadWahooFitRoute(file: FileInterface): Promise<boolean> {
    if (file.extension.toLowerCase() !== 'fit') {
      throw new Error('Only FIT route files are supported by Wahoo.');
    }
    if (!this.auth.currentUser) {
      throw new Error('User not logged in');
    }
    if (file.file.size > MAX_WAHOO_ROUTE_UPLOAD_BYTES) {
      throw new Error('Cannot upload route because the size is greater than 20MB');
    }

    const fileBuffer = await this.readFileAsArrayBuffer(file.file);
    if (fileBuffer.byteLength > MAX_WAHOO_ROUTE_UPLOAD_BYTES) {
      throw new Error('Cannot upload route because the size is greater than 20MB');
    }

    if (file.jobId) {
      this.processingService.updateJob(file.jobId, { progress: 50 });
    }

    try {
      await this.functionsService.call<{
        file: string;
        filename: string;
      }, { status: string }>(
        'importRouteToWahooAPI',
        {
          file: this.arrayBufferToBase64(fileBuffer),
          filename: file.name || `${file.filename}.${file.extension}`,
        },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.snackBar.open(`Could not upload ${file.name}, reason: ${errorMessage}`, 'OK', { duration: 10000 });
      throw error;
    }

    if (file.jobId) {
      this.processingService.updateJob(file.jobId, { progress: 100 });
    }
    return true;
  }

  private readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader();
      fileReader.onerror = () => reject(new Error('Could not read the FIT route file.'));
      fileReader.onload = () => {
        if (!(fileReader.result instanceof ArrayBuffer)) {
          reject(new Error('Could not read the FIT route file.'));
          return;
        }
        resolve(fileReader.result);
      };
      fileReader.readAsArrayBuffer(file);
    });
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE));
    }
    return btoa(binary);
  }
}
