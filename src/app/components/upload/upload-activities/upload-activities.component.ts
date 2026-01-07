import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AppEventService } from '../../../services/app.event.service';
import { AppFileService } from '../../../services/app.file.service';
import { AppUserService } from '../../../services/app.user.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EventInterface } from '@sports-alliance/sports-lib';
import { EventImporterSuuntoJSON } from '@sports-alliance/sports-lib';
import { EventImporterFIT } from '@sports-alliance/sports-lib';
import { EventImporterTCX } from '@sports-alliance/sports-lib';
import { EventImporterGPX } from '@sports-alliance/sports-lib';
import { EventImporterSuuntoSML } from '@sports-alliance/sports-lib';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { UploadAbstractDirective } from '../upload-abstract.directive';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { AppProcessingService } from '../../../services/app.processing.service';
import { Overlay } from '@angular/cdk/overlay';
import { USAGE_LIMITS } from '../../../../../functions/src/shared/limits';
import { LoggerService } from '../../../services/logger.service';


import { EventJSONSanitizer } from '../../../utils/event-json-sanitizer';

@Component({
  selector: 'app-upload-activities',
  templateUrl: './upload-activities.component.html',
  styleUrls: ['../upload-abstract.css', './upload-activities.component.css'],
  standalone: false
})
export class UploadActivitiesComponent extends UploadAbstractDirective implements OnInit {
  public uploadCount: number | null = null;
  public uploadLimit: number | null = null;
  public isPro: boolean = false;

  constructor(
    protected snackBar: MatSnackBar,
    protected dialog: MatDialog,
    protected bottomSheet: MatBottomSheet,
    protected processingService: AppProcessingService,
    protected overlay: Overlay,
    protected eventService: AppEventService,
    protected router: Router,
    protected logger: LoggerService,
    protected fileService: AppFileService,
    protected userService: AppUserService,
    protected analyticsService: AppAnalyticsService) {
    super(snackBar, dialog, processingService, router, logger);
  }

  async ngOnInit() {
    super.ngOnInit();
    await this.calculateRemainingUploads();
  }

  async calculateRemainingUploads() {
    if (!this.user) return;

    // Fetch Role
    this.isPro = await this.userService.isPro();
    if (this.isPro) return; // Unlimited

    // Fetch Count
    this.uploadCount = await this.eventService.getEventCount(this.user);

    // Get Limit
    const role = await this.userService.getSubscriptionRole() || 'free';
    // Import dynamically or use a known path if possible, but for now let's rely on the import I will add
    this.uploadLimit = USAGE_LIMITS[role] || USAGE_LIMITS['free'];
  }

  processAndUploadFile(file: any): Promise<EventInterface> {
    this.analyticsService.logEvent('upload_file', { method: file.extension });
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader;
      fileReader.onload = async () => {
        let newEvent;
        let fileReaderResult = fileReader.result;

        // Decompress if needed (gzip magic bytes check)
        if (fileReaderResult instanceof ArrayBuffer) {
          fileReaderResult = await this.fileService.decompressIfNeeded(fileReaderResult as ArrayBuffer);
        }
        try {
          if ((fileReaderResult instanceof ArrayBuffer) && file.extension === 'fit') {
            newEvent = await EventImporterFIT.getFromArrayBuffer(fileReaderResult);
          } else if (fileReaderResult instanceof ArrayBuffer) {
            // Deciding based on normalized extension
            const text = new TextDecoder().decode(fileReaderResult);
            if (file.extension === 'json') {
              try {
                const json = JSON.parse(text);
                const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(json);
                if (unknownTypes.length > 0) {
                  this.logger.captureMessage('Unknown Data Types in Upload', { extra: { types: unknownTypes, file: file.filename } });
                  this.snackBar.open(`Warning: Unknown data types removed: ${unknownTypes.join(', ')}`, 'OK', { duration: 5000 });
                }
                newEvent = await EventImporterSuuntoJSON.getFromJSONString(JSON.stringify(sanitizedJson));
              } catch (e) {
                newEvent = await EventImporterSuuntoSML.getFromJSONString(text);
              }
            } else if (file.extension === 'sml') {
              newEvent = await EventImporterSuuntoSML.getFromXML(text);
            } else if (file.extension === 'tcx') {
              newEvent = await EventImporterTCX.getFromXML((new DOMParser()).parseFromString(text, 'application/xml'));
            } else if (file.extension === 'gpx') {
              newEvent = await EventImporterGPX.getFromString(text);
            } else {
              reject(new Error('No compatible parser found'));
              return;
            }
          } else {
            reject(new Error('No compatible parser found'))
            return;
          }
          // Sanitize the resulting EventInterface object? 
          // If the importer worked, it means it didn't crash.
          // However, if we didn't sanitize JSON inputs for other formats (like SML converted to JSON internally?), we might miss some.
          // But the JSON importer is the one prone to "Class type ... not in store" if it walks the JSON directly.
          // For now, handling the .json extension is the critical path requested.

          newEvent.name = file.filename;
        } catch (e: any) {
          this.snackBar.open(`Could not upload ${file.filename}.${file.extension}, reason: ${e.message}`, 'OK', { duration: 2000 });
          reject(e); // no-op here!
          return;
        }
        try {
          await this.eventService.writeAllEventData(this.user, newEvent, {
            data: fileReaderResult as any, // ArrayBuffer or string
            extension: file.extension,
            startDate: newEvent.startDate,
            originalFilename: file.filename
          });
          // Refresh count
          await this.calculateRemainingUploads();
        } catch (e: any) {
          this.snackBar.open(`Could not upload ${file.filename}, reason: ${e.message}`);
          reject(e);
          return;
        }

        this.logger.log('Successfully uploaded event. ID:', newEvent.getID());
        resolve(newEvent);
      };
      // Always read as ArrayBuffer to allow for decompression if it's a .gz file
      fileReader.readAsArrayBuffer(file.file);
    });
  }
}
