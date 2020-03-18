import { Component } from '@angular/core';
import { AppEventService } from '../../../services/app.event.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import { EventInterface } from '@sports-alliance/sports-lib/lib/events/event.interface';
import { EventImporterSuuntoJSON } from '@sports-alliance/sports-lib/lib/events/adapters/importers/suunto/importer.suunto.json';
import { EventImporterFIT } from '@sports-alliance/sports-lib/lib/events/adapters/importers/fit/importer.fit';
import { EventImporterTCX } from '@sports-alliance/sports-lib/lib/events/adapters/importers/tcx/importer.tcx';
import { EventImporterGPX } from '@sports-alliance/sports-lib/lib/events/adapters/importers/gpx/importer.gpx';
import { UploadErrorComponent } from '../upload-error/upload-error.component';
import { UPLOAD_STATUS } from '../upload-status/upload.status';
import { Log } from 'ng2-logger/browser';
import { EventImporterSuuntoSML } from '@sports-alliance/sports-lib/lib/events/adapters/importers/suunto/importer.suunto.sml';
import { AngularFireAnalytics } from '@angular/fire/analytics';
import { UploadAbstractDirective } from '../upload-abstract.directive';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { AppFilesStatusService } from '../../../services/upload/app-files-status.service';
import { Overlay } from '@angular/cdk/overlay';

@Component({
  selector: 'app-upload',
  templateUrl: './upload-activities.component.html',
  styleUrls: ['./upload-activities.component.css'],
})

export class UploadActivitiesComponent extends UploadAbstractDirective {

  constructor(
    protected snackBar: MatSnackBar,
    protected dialog: MatDialog,
    protected bottomSheet: MatBottomSheet,
    protected filesStatusService: AppFilesStatusService,
    protected overlay: Overlay,
    private eventService: AppEventService,
    private afa: AngularFireAnalytics) {
    super(snackBar, dialog, bottomSheet, filesStatusService, overlay, Log.create('UploadActivitiesComponent'))
  }

  processAndUploadFile(file): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader;
      fileReader.onload = async () => {
        let newEvent;
        const fileReaderResult = fileReader.result;
        try {
          if ((typeof fileReaderResult === 'string') && file.extension === 'json') {
            try {
              newEvent = await EventImporterSuuntoJSON.getFromJSONString(fileReaderResult);
            } catch (e) {
              this.logger.info(`Could not read via JSON trying via SML JSON`);
              newEvent = await EventImporterSuuntoSML.getFromJSONString(fileReaderResult);
            }
          } else if ((typeof fileReaderResult === 'string') && file.extension === 'sml') {
            newEvent = await EventImporterSuuntoSML.getFromXML(fileReaderResult, 'application/xml');
          } else if ((typeof fileReaderResult === 'string') && file.extension === 'tcx') {
            newEvent = await EventImporterTCX.getFromXML((new DOMParser()).parseFromString(fileReaderResult, 'application/xml'));
          } else if ((typeof fileReaderResult === 'string') && file.extension === 'gpx') {
            newEvent = await EventImporterGPX.getFromString(fileReaderResult);
          } else if ((fileReaderResult instanceof ArrayBuffer) && file.extension === 'fit') {
            newEvent = await EventImporterFIT.getFromArrayBuffer(fileReaderResult);
          } else {
            resolve();
            return;
          }
          newEvent.name = file.filename;
        } catch (e) {
          file.status = UPLOAD_STATUS.ERROR;
          Sentry.captureException(e);
          this.logger.error(`Could not load event from file`, e);
          reject(); // no-op here!
          return;
        }
        try {
          await this.eventService.writeAllEventData(this.user, newEvent);
          this.afa.logEvent('upload_file', {method: file.extension});
          file.status = UPLOAD_STATUS.PROCESSED;
        } catch (e) {
          // debugger;
          console.error(e);
          Sentry.captureException(e);
          file.status = UPLOAD_STATUS.ERROR;
          reject();
          return;
        }
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
