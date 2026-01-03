import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AppEventService } from '../../../services/app.event.service';
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
import { AppFilesStatusService } from '../../../services/upload/app-files-status.service';
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
  private analyticsService = inject(AppAnalyticsService);
  public uploadCount: number | null = null;
  public uploadLimit: number | null = null;
  public isPro: boolean = false;
  private userService = inject(AppUserService);

  constructor(
    protected snackBar: MatSnackBar,
    protected dialog: MatDialog,
    protected bottomSheet: MatBottomSheet,
    protected filesStatusService: AppFilesStatusService,
    protected overlay: Overlay,
    private eventService: AppEventService,
    protected router: Router,
    logger: LoggerService) {
    super(snackBar, dialog, filesStatusService, router, logger);
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

  processAndUploadFile(file): Promise<EventInterface> {
    this.analyticsService.logEvent('upload_file', { method: file.extension });
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader;
      fileReader.onload = async () => {
        let newEvent;
        const fileReaderResult = fileReader.result;
        try {
          if ((typeof fileReaderResult === 'string') && file.extension === 'json') {
            try {
              // Parse first to sanitize
              const json = JSON.parse(fileReaderResult as string);
              const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(json);

              if (unknownTypes.length > 0) {
                this.logger.captureMessage('Unknown Data Types in Upload', { extra: { types: unknownTypes, file: file.filename } });
                this.snackBar.open(`Warning: Unknown data types removed: ${unknownTypes.join(', ')}`, 'OK', { duration: 5000 });
              }

              // Re-serialize for the importer if it expects a string, or see if it accepts object
              // EventImporterSuuntoJSON.getFromJSONString expects string.
              // Just pass the sanitized object if possible. Checking library... 
              // It seems getFromJSONString calls EventImporterJSON.getFromJSON(JSON.parse(str)).
              // So we can probably skip getFromJSONString and call getFromJSON if we had access, but checking imports...
              // EventImporterSuuntoJSON extends EventImporterJSON.
              // For safety and compatibility with current code structure, we'll re-stringify.
              newEvent = await EventImporterSuuntoJSON.getFromJSONString(JSON.stringify(sanitizedJson));

            } catch (e) {

              newEvent = await EventImporterSuuntoSML.getFromJSONString(fileReaderResult);
            }
          } else if ((typeof fileReaderResult === 'string') && file.extension === 'sml') {
            newEvent = await EventImporterSuuntoSML.getFromXML(fileReaderResult);
          } else if ((typeof fileReaderResult === 'string') && file.extension === 'tcx') {
            newEvent = await EventImporterTCX.getFromXML((new DOMParser()).parseFromString(fileReaderResult, 'application/xml'));
          } else if ((typeof fileReaderResult === 'string') && file.extension === 'gpx') {
            newEvent = await EventImporterGPX.getFromString(fileReaderResult);
          } else if ((fileReaderResult instanceof ArrayBuffer) && file.extension === 'fit') {
            newEvent = await EventImporterFIT.getFromArrayBuffer(fileReaderResult);
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
        } catch (e) {
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
        } catch (e) {
          this.snackBar.open(`Could not upload ${file.filename}, reason: ${e.message}`);
          reject(e);
          return;
        }

        this.logger.log('Successfully uploaded event. ID:', newEvent.getID());
        resolve(newEvent);
      };
      // Read it depending on the extension
      if (file.extension === 'fit') {
        // Fit files should be read as array buffers
        fileReader.readAsArrayBuffer(file.file);
      } else {
        // All other as text
        fileReader.readAsText(file.file);
      }
    });
  }
}
