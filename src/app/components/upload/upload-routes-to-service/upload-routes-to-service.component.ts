import { Component, inject, Input } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { Auth } from 'app/firebase/auth';
import { UploadAbstractDirective } from '../upload-abstract.directive';
import { FileInterface } from '../file.interface';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { AppFunctionsService } from '../../../services/app.functions.service';

const MAX_ROUTE_UPLOAD_BYTES = 20 * 1024 * 1024;
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

  get acceptsFitAndGpxRoutes(): boolean {
    return [
      ServiceNames.SuuntoApp,
      ServiceNames.GarminAPI,
      ServiceNames.WahooAPI,
    ].includes(this.serviceName);
  }

  get fileAccept(): string {
    return this.acceptsFitAndGpxRoutes ? '.fit,.gpx' : '.gpx';
  }

  get uploadPrompt(): string {
    return this.acceptsFitAndGpxRoutes ? 'Open or drag and drop GPX or FIT route files' : 'Open or drag and drop GPX route files';
  }

  constructor() {
    super();
    if (this.data?.serviceName) {
      this.serviceName = this.data.serviceName;
    }
  }

  async processAndUploadFile(file: FileInterface) {
    this.analyticsService.logEvent('upload_route_to_service', { service: this.serviceName });
    if (this.serviceName === ServiceNames.WahooAPI) {
      return this.processAndUploadWahooRoute(file);
    }
    if (this.serviceName === ServiceNames.GarminAPI) {
      return this.processAndUploadRouteForService(file, 'importRouteToGarminAPI', 'Garmin');
    }
    if (this.serviceName === ServiceNames.SuuntoApp) {
      return this.processAndUploadRouteForService(file, 'importRouteToSuuntoApp', 'Suunto');
    }
    throw new Error(`Manual route upload is not supported by ${this.serviceName}.`);
  }

  private async processAndUploadWahooRoute(file: FileInterface): Promise<boolean> {
    return this.processAndUploadRouteForService(file, 'importRouteToWahooAPI', 'Wahoo');
  }

  private async processAndUploadRouteForService(
    file: FileInterface,
    functionName: 'importRouteToGarminAPI' | 'importRouteToSuuntoApp' | 'importRouteToWahooAPI',
    serviceLabel: string,
  ): Promise<boolean> {
    if (!['fit', 'gpx'].includes(file.extension.toLowerCase())) {
      throw new Error(`Only GPX or FIT route files are supported by ${serviceLabel}.`);
    }
    if (!this.auth.currentUser) {
      throw new Error('User not logged in');
    }
    if (file.file.size > MAX_ROUTE_UPLOAD_BYTES) {
      throw new Error('Cannot upload route because the size is greater than 20MB');
    }

    const fileBuffer = await this.readFileAsArrayBuffer(file.file);
    if (fileBuffer.byteLength > MAX_ROUTE_UPLOAD_BYTES) {
      throw new Error('Cannot upload route because the size is greater than 20MB');
    }

    if (file.jobId) {
      this.processingService.updateJob(file.jobId, { progress: 50 });
    }

    const fileName = file.name || `${file.filename}.${file.extension}`;
    try {
      await this.functionsService.call<{
        file: string;
        filename: string;
      }, { status: string }>(
        functionName,
        {
          file: this.arrayBufferToBase64(fileBuffer),
          filename: fileName,
        },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.snackBar.open(`Could not upload ${fileName}, reason: ${errorMessage}`, 'OK', { duration: 10000 });
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
      fileReader.onerror = () => reject(new Error('Could not read the route file.'));
      fileReader.onload = () => {
        if (!(fileReader.result instanceof ArrayBuffer)) {
          reject(new Error('Could not read the route file.'));
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
