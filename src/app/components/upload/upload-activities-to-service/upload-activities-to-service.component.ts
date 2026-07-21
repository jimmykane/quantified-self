import { Component, computed, inject, Input, OnDestroy, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { Auth } from 'app/firebase/auth';
import { UploadAbstractDirective } from '../upload-abstract.directive';
import { FileInterface } from '../file.interface';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { AppFunctionsService } from '../../../services/app.functions.service';
import { UPLOAD_STATUS } from '../upload-status/upload.status';
import type { FunctionName } from '@shared/functions-manifest';
import { getProviderDisplayName } from '@shared/provider-presentation';

const MAX_ACTIVITY_UPLOAD_TO_SERVICE_BYTES = 20 * 1024 * 1024;
const BASE64_CHUNK_SIZE = 0x8000;
const SERVICE_ACTIVITY_UPLOAD_DELAY_MS = 2000;
const WAHOO_STATUS_POLL_DELAY_MS = 2000;
const WAITING_FOR_NEXT_UPLOAD_MESSAGE = 'Waiting before next upload...';

type ServiceUploadStatus = 'queued' | 'uploading' | 'processing' | 'success' | 'duplicate' | 'failed';

interface ServiceUploadRow {
  id: string;
  file: File;
  name: string;
  filename: string;
  extension: string;
  sizeLabel: string;
  status: ServiceUploadStatus;
  attempts: number;
  progress: number;
  message: string | null;
  jobId?: string;
  uploadId?: string;
}

interface ServiceUploadResult {
  success: boolean;
  duplicate: boolean;
  pending?: boolean;
  uploadId?: string;
  message?: string;
}

interface ServiceUploadCallableResponse {
  status?: string;
  code?: string;
  message?: string;
  uploadId?: string;
  result?: {
    status?: string;
    code?: string;
    message?: string;
    uploadId?: string;
  };
}

@Component({
  selector: 'app-upload-activity-to-service',
  templateUrl: './upload-activities-to-service.component.html',
  styleUrls: ['../upload-abstract.css', './upload-activities-to-service.component.css'],
  standalone: false
})

export class UploadActivitiesToServiceComponent extends UploadAbstractDirective implements OnDestroy {
  public data = inject(MAT_DIALOG_DATA, { optional: true });
  public dialogRef = inject(MatDialogRef<UploadActivitiesToServiceComponent>, { optional: true });
  private auth = inject(Auth);
  private analyticsService = inject(AppAnalyticsService);

  private functionsService = inject(AppFunctionsService);
  private rowIdCounter = 0;
  private readonly wahooStatusPollTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly wahooStatusChecksInProgress = new Set<string>();
  private _serviceName: ServiceNames = ServiceNames.SuuntoApp;

  @Input() set serviceName(value: ServiceNames) {
    this._serviceName = value || ServiceNames.SuuntoApp;
    this.destinationName = getProviderDisplayName(this._serviceName, 'destination');
    this.callableFunction = this._serviceName === ServiceNames.COROSAPI
      ? 'importActivityToCOROSAPI'
      : this._serviceName === ServiceNames.WahooAPI
        ? 'importActivityToWahooAPI'
        : 'importActivityToSuuntoApp';
  }

  get serviceName(): ServiceNames {
    return this._serviceName;
  }

  public destinationName = getProviderDisplayName(ServiceNames.SuuntoApp, 'destination');
  public callableFunction: FunctionName = 'importActivityToSuuntoApp';
  public uploadDelayMs = SERVICE_ACTIVITY_UPLOAD_DELAY_MS;
  public wahooStatusPollDelayMs = WAHOO_STATUS_POLL_DELAY_MS;
  public readonly displayedColumns = ['file', 'status', 'attempts', 'message', 'actions'];
  public readonly uploadRows = signal<ServiceUploadRow[]>([]);
  public readonly hasRows = computed(() => this.uploadRows().length > 0);
  public readonly failedRows = computed(() => this.uploadRows().filter((row) => row.status === 'failed' && row.extension === 'fit'));
  public readonly canRetryFailed = computed(() => this.failedRows().length > 0);
  public readonly uploadSummary = computed(() => {
    const rows = this.uploadRows();
    if (rows.length === 0) {
      return '';
    }

    const uploading = rows.filter((row) => row.status === 'uploading' || row.status === 'processing' || row.status === 'queued').length;
    const complete = rows.filter((row) => row.status === 'success' || row.status === 'duplicate').length;
    const failed = rows.filter((row) => row.status === 'failed').length;
    const parts = [`${complete}/${rows.length} done`];
    if (uploading > 0) {
      parts.push(`${uploading} active`);
    }
    if (failed > 0) {
      parts.push(`${failed} failed`);
    }
    return parts.join(' · ');
  });

  public readonly statusLabelMap: Record<ServiceUploadStatus, string> = {
    queued: 'Queued',
    uploading: 'Uploading',
    processing: 'Processing',
    success: 'Uploaded',
    duplicate: 'Already exists',
    failed: 'Failed',
  };

  public readonly statusIconMap: Record<ServiceUploadStatus, string> = {
    queued: 'schedule',
    uploading: 'sync',
    processing: 'sync',
    success: 'check_circle',
    duplicate: 'info',
    failed: 'error',
  };

  constructor() {
    super();
    if (this.data?.serviceName) {
      this.serviceName = this.data.serviceName;
    }
  }

  ngOnDestroy(): void {
    this.clearAllWahooStatusPolls();
  }

  async getFiles(event: any): Promise<void> {
    event.stopPropagation();
    event.preventDefault();

    if (this.isUploading) {
      this.clearUploadEvent(event);
      return;
    }

    if (!this.hasProAccess) {
      this.snackBar.open('This feature is available for Pro users.', 'OK', { duration: 5000 });
      this.clearUploadEvent(event);
      return;
    }

    const rawFiles = this.extractFilesFromEvent(event);
    const rows = rawFiles.map((file) => this.createUploadRow(file));
    this.uploadRows.update((currentRows) => [...currentRows, ...rows]);

    if (rows.length === 0) {
      this.clearUploadEvent(event);
      return;
    }

    await this.processRows(rows.map((row) => row.id), true);
    this.clearUploadEvent(event);
  }

  async retryUpload(row: ServiceUploadRow): Promise<void> {
    if (this.isUploading || row.status !== 'failed' || row.extension !== 'fit') {
      return;
    }

    await this.processRows([row.id], true);
  }

  async retryFailedUploads(): Promise<void> {
    if (this.isUploading) {
      return;
    }

    await this.processRows(this.failedRows().map((row) => row.id), true);
  }

  async refreshUpload(row: ServiceUploadRow): Promise<void> {
    if (row.status !== 'processing'
      || !row.uploadId
      || this.serviceName !== ServiceNames.WahooAPI
      || this.wahooStatusChecksInProgress.has(row.id)) {
      return;
    }

    this.clearWahooStatusPoll(row.id);
    this.wahooStatusChecksInProgress.add(row.id);
    this.updateRow(row.id, { message: 'Checking Wahoo processing status...' });
    try {
      const response = await this.functionsService.call<any, ServiceUploadCallableResponse>(
        'getWahooAPIWorkoutFileUploadStatus',
        { uploadId: row.uploadId },
      );
      const result = this.toServiceUploadResult(response.data);
      if (result.pending) {
        this.updateRow(row.id, { message: result.message || 'Wahoo is still processing the activity.' });
        this.scheduleWahooStatusPoll(row.id);
        return;
      }
      if (result.duplicate) {
        const message = result.message || `Activity already exists in ${this.destinationName}`;
        this.updateRow(row.id, { status: 'duplicate', progress: 100, message });
        this.processingService.updateJob(row.jobId || row.id, { status: 'duplicate', progress: 100, details: message });
        this.clearWahooStatusPoll(row.id);
        return;
      }
      const message = result.message || `Uploaded to ${this.destinationName}`;
      this.updateRow(row.id, { status: 'success', progress: 100, message });
      this.processingService.completeJob(row.jobId || row.id, message);
      this.clearWahooStatusPoll(row.id);
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.logger.error(error);
      this.updateRow(row.id, { status: 'failed', progress: 0, message });
      this.processingService.failJob(row.jobId || row.id, message);
      this.clearWahooStatusPoll(row.id);
    } finally {
      this.wahooStatusChecksInProgress.delete(row.id);
    }
  }

  clearRows(): void {
    if (this.isUploading) {
      return;
    }

    this.clearAllWahooStatusPolls();
    this.uploadRows.set([]);
  }

  async processAndUploadFile(file: FileInterface): Promise<ServiceUploadResult> {
    this.analyticsService.logEvent('upload_activity_to_service', { service: this.serviceName });

    if (file.extension !== 'fit') {
      throw new Error('Only FIT files are supported.');
    }
    if (!this.auth.currentUser) {
      throw new Error('User not logged in');
    }

    if (file.file.size > MAX_ACTIVITY_UPLOAD_TO_SERVICE_BYTES) {
      throw new Error('Cannot upload activity because the size is greater than 20MB');
    }

    const payload = await this.readFileAsArrayBuffer(file.file);
    if (payload.byteLength > MAX_ACTIVITY_UPLOAD_TO_SERVICE_BYTES) {
      throw new Error('Cannot upload activity because the size is greater than 20MB');
    }

    const base64String = this.arrayBufferToBase64(payload);

    if (file.jobId) {
      this.processingService.updateJob(file.jobId, { progress: 50 });
    }

    const response = await this.functionsService.call<any, ServiceUploadCallableResponse>(
      this.callableFunction,
      this.serviceName === ServiceNames.WahooAPI
        ? {
          file: base64String,
          filename: file.name,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }
        : { file: base64String }
    );

    if (file.jobId) {
      this.processingService.updateJob(file.jobId, { progress: 100 });
    }

    this.logger.info(`${this.destinationName} upload response:`, response.data);

    const result = this.toServiceUploadResult(response.data);
    if (result.duplicate) {
      const message = result.message || `Activity already exists in ${this.destinationName}`;
      if (file.jobId) {
        this.processingService.updateJob(file.jobId, { status: 'duplicate', progress: 100, details: message });
      }
      return { success: true, duplicate: true, message };
    }

    return result;
  }

  private async processRows(rowIds: string[], showSummary: boolean): Promise<void> {
    if (rowIds.length === 0) {
      return;
    }

    this.isUploading = true;
    try {
      this.markUploadableRowsQueued(rowIds);
      for (let index = 0; index < rowIds.length; index++) {
        const attemptedUpload = await this.processRow(rowIds[index]);
        if (attemptedUpload) {
          await this.waitBeforeNextUpload(rowIds, index + 1);
        }
      }
    } finally {
      this.isUploading = false;
    }

    if (showSummary) {
      this.showBatchSummary(rowIds);
    }
  }

  private async processRow(rowId: string): Promise<boolean> {
    const row = this.findRow(rowId);
    if (!row || row.status === 'uploading') {
      return false;
    }

    if (row.extension !== 'fit') {
      this.updateRow(row.id, {
        status: 'failed',
        progress: 0,
        message: 'Only FIT files are supported.',
      });
      return false;
    }

    const jobId = this.processingService.addJob('upload', `Uploading ${row.name}...`);
    const attempts = row.attempts + 1;
    this.updateRow(row.id, {
      jobId,
      attempts,
      status: 'uploading',
      progress: 0,
      message: null,
    });
    this.processingService.updateJob(jobId, { status: 'processing', progress: 0 });

    try {
      const result = await this.processAndUploadFile(this.toFileItem(row, jobId));
      const completedRow = this.findRow(rowId);
      if (!completedRow) {
        return true;
      }

      if (result.duplicate) {
        const message = result.message || `Activity already exists in ${this.destinationName}`;
        this.updateRow(row.id, {
          status: 'duplicate',
          progress: 100,
          message,
        });
        this.processingService.updateJob(jobId, { status: 'duplicate', progress: 100, details: message });
        return true;
      }

      if (result.pending) {
        const message = result.message || `${this.destinationName} is processing the activity.`;
        this.updateRow(row.id, {
          status: 'processing',
          progress: 75,
          message,
          uploadId: result.uploadId,
        });
        this.processingService.updateJob(jobId, { status: 'processing', progress: 75, details: message });
        this.scheduleWahooStatusPoll(row.id);
        return true;
      }

      const message = result.message || `Uploaded to ${this.destinationName}`;
      this.updateRow(row.id, {
        status: 'success',
        progress: 100,
        message,
      });
      this.processingService.completeJob(jobId, message);
      return true;
    } catch (error: unknown) {
      this.logger.error(error);
      const message = this.getErrorMessage(error);
      this.updateRow(row.id, {
        status: 'failed',
        progress: 0,
        message,
      });
      this.processingService.failJob(jobId, message);
      return true;
    }
  }

  private markUploadableRowsQueued(rowIds: string[]): void {
    const rowIdSet = new Set(rowIds);
    this.uploadRows.update((rows) => rows.map((row) => {
      if (!rowIdSet.has(row.id) || row.extension !== 'fit') {
        return row;
      }

      return {
        ...row,
        status: 'queued',
        message: null,
        progress: 0,
      };
    }));
  }

  private toFileItem(row: ServiceUploadRow, jobId: string): FileInterface {
    return {
      file: row.file,
      name: row.name,
      extension: row.extension,
      filename: row.filename,
      jobId,
      status: UPLOAD_STATUS.PROCESSING,
    };
  }

  private createUploadRow(file: File): ServiceUploadRow {
    const name = file.name || 'activity.fit';
    const extension = this.getExtension(name);
    const filename = this.getFilename(name);
    const isFitFile = extension === 'fit';

    return {
      id: `service-upload-${Date.now()}-${this.rowIdCounter++}`,
      file,
      name,
      filename,
      extension,
      sizeLabel: this.formatFileSize(file.size),
      status: isFitFile ? 'queued' : 'failed',
      attempts: 0,
      progress: 0,
      message: isFitFile ? null : 'Only FIT files are supported.',
    };
  }

  private updateRow(rowId: string, updates: Partial<Omit<ServiceUploadRow, 'id' | 'file'>>): void {
    this.uploadRows.update((rows) => rows.map((row) => row.id === rowId ? { ...row, ...updates } : row));
  }

  private scheduleWahooStatusPoll(rowId: string): void {
    const row = this.findRow(rowId);
    if (this.serviceName !== ServiceNames.WahooAPI || row?.status !== 'processing' || !row.uploadId) {
      return;
    }

    this.clearWahooStatusPoll(rowId);
    const timer = setTimeout(() => {
      this.wahooStatusPollTimers.delete(rowId);
      const currentRow = this.findRow(rowId);
      if (currentRow) {
        void this.refreshUpload(currentRow);
      }
    }, this.wahooStatusPollDelayMs);
    this.wahooStatusPollTimers.set(rowId, timer);
  }

  private clearWahooStatusPoll(rowId: string): void {
    const timer = this.wahooStatusPollTimers.get(rowId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.wahooStatusPollTimers.delete(rowId);
    }
  }

  private clearAllWahooStatusPolls(): void {
    this.wahooStatusPollTimers.forEach((timer) => clearTimeout(timer));
    this.wahooStatusPollTimers.clear();
  }

  private findRow(rowId: string): ServiceUploadRow | undefined {
    return this.uploadRows().find((row) => row.id === rowId);
  }

  private async waitBeforeNextUpload(rowIds: string[], startIndex: number): Promise<void> {
    const nextRow = this.findNextUploadableRow(rowIds, startIndex);
    if (!nextRow || this.uploadDelayMs <= 0) {
      return;
    }

    this.updateRow(nextRow.id, {
      message: WAITING_FOR_NEXT_UPLOAD_MESSAGE,
    });
    await this.sleep(this.uploadDelayMs);

    const latestNextRow = this.findRow(nextRow.id);
    if (latestNextRow?.status === 'queued' && latestNextRow.message === WAITING_FOR_NEXT_UPLOAD_MESSAGE) {
      this.updateRow(nextRow.id, { message: null });
    }
  }

  private findNextUploadableRow(rowIds: string[], startIndex: number): ServiceUploadRow | undefined {
    for (let index = startIndex; index < rowIds.length; index++) {
      const row = this.findRow(rowIds[index]);
      if (row?.extension === 'fit') {
        return row;
      }
    }

    return undefined;
  }

  private showBatchSummary(rowIds: string[]): void {
    const rows = this.uploadRows().filter((row) => rowIds.includes(row.id));
    if (rows.length === 0) {
      return;
    }

    const successfulUploads = rows.filter((row) => row.status === 'success').length;
    const duplicateUploads = rows.filter((row) => row.status === 'duplicate').length;
    const pendingUploads = rows.filter((row) => row.status === 'processing').length;
    const failedUploads = rows.filter((row) => row.status === 'failed').length;

    let message = '';
    if (rows.length === 1) {
      if (duplicateUploads === 1) {
        message = 'Activity already exists';
      } else if (pendingUploads === 1) {
        message = `${this.destinationName} is processing the activity`;
      } else if (successfulUploads === 1) {
        message = 'Successfully uploaded';
      } else {
        message = 'Upload failed';
      }
    } else {
      const parts = [];
      if (successfulUploads > 0) parts.push(`${successfulUploads} successful`);
      if (duplicateUploads > 0) parts.push(`${duplicateUploads} already exist`);
      if (pendingUploads > 0) parts.push(`${pendingUploads} processing`);
      if (failedUploads > 0) parts.push(`${failedUploads} failed`);
      message = `Processed ${rows.length} files: ${parts.join(', ')}`;
    }

    this.snackBar.open(message, 'OK', { duration: 5000 });
  }

  private readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader();
      fileReader.onload = () => {
        if (fileReader.result instanceof ArrayBuffer) {
          resolve(fileReader.result);
          return;
        }

        reject(new Error('Could not read FIT file.'));
      };
      fileReader.onerror = () => reject(new Error('Could not read FIT file.'));
      fileReader.readAsArrayBuffer(file);
    });
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index += BASE64_CHUNK_SIZE) {
      const chunk = bytes.subarray(index, index + BASE64_CHUNK_SIZE);
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  }

  private extractFilesFromEvent(event: any): File[] {
    const targetFiles = event.target?.files;
    if (targetFiles?.length > 0) {
      return Array.from(targetFiles);
    }

    const transferFiles = event.dataTransfer?.files;
    if (transferFiles?.length > 0) {
      return Array.from(transferFiles);
    }

    return [];
  }

  private clearUploadEvent(event: any): void {
    this.removeDragState(event.currentTarget);
    this.removeDragState(event.target);

    if (event.dataTransfer?.items) {
      event.dataTransfer.items.clear();
    } else if (event.dataTransfer) {
      event.dataTransfer.clearData();
    }

    if (event.target && typeof event.target.value !== 'undefined') {
      event.target.value = '';
    }
  }

  private removeDragState(target: unknown): void {
    if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) {
      target.classList.remove('drag');
    }
  }

  private getExtension(name: string): string {
    return name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
  }

  private getFilename(name: string): string {
    if (!name.includes('.')) {
      return name;
    }

    const parts = name.split('.');
    parts.pop();
    return parts.join('.') || name;
  }

  private formatFileSize(size: number): string {
    if (size >= 1024 * 1024) {
      return `${(size / 1024 / 1024).toFixed(1)} MB`;
    }
    if (size >= 1024) {
      return `${Math.round(size / 1024)} KB`;
    }
    return `${size} B`;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }

    const message = (error as { message?: unknown; error?: unknown } | null)?.message
      || (error as { error?: unknown } | null)?.error;
    return typeof message === 'string' ? message : 'Unknown error';
  }

  private toServiceUploadResult(response: ServiceUploadCallableResponse | undefined): ServiceUploadResult {
    const responseCode = response?.code || response?.result?.code;
    const responseMessage = response?.message || response?.result?.message;
    const responseStatus = `${response?.status || response?.result?.status || ''}`.trim().toLowerCase();
    const uploadId = response?.uploadId || response?.result?.uploadId;
    if (responseCode === 'ALREADY_EXISTS') {
      return { success: true, duplicate: true, message: responseMessage };
    }
    if (responseStatus === 'pending' || responseStatus === 'processing') {
      return {
        success: false,
        duplicate: false,
        pending: true,
        uploadId,
        message: responseMessage,
      };
    }
    return {
      success: true,
      duplicate: false,
      message: responseMessage || `Uploaded to ${this.destinationName}`,
    };
  }
}
