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

@Component({
  selector: 'app-upload',
  templateUrl: './upload-activities.component.html',
  styleUrls: ['./upload-activities.component.css'],
})

export class UploadActivitiesComponent extends UploadAbstractDirective {

  constructor(
    protected snackBar: MatSnackBar,
    protected dialog: MatDialog,
    private eventService: AppEventService,
    private afa: AngularFireAnalytics) {
    super(snackBar, dialog, Log.create('UploadActivitiesComponent'));
  }

  processAndUploadFile(metaData): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader;
      fileReader.onload = async () => {
        let newEvent;
        const fileReaderResult = fileReader.result;
        try {
          if ((typeof fileReaderResult === 'string') && metaData.extension === 'json') {
            try {
              newEvent = await EventImporterSuuntoJSON.getFromJSONString(fileReaderResult);
            } catch (e) {
              this.logger.info(`Could not read via JSON trying via SML JSON`);
              newEvent = await EventImporterSuuntoSML.getFromJSONString(fileReaderResult);
            }
          } else if ((typeof fileReaderResult === 'string') && metaData.extension === 'sml') {
            newEvent = await EventImporterSuuntoSML.getFromXML(fileReaderResult, 'application/xml');
          } else if ((typeof fileReaderResult === 'string') && metaData.extension === 'tcx') {
            newEvent = await EventImporterTCX.getFromXML((new DOMParser()).parseFromString(fileReaderResult, 'application/xml'));
          } else if ((typeof fileReaderResult === 'string') && metaData.extension === 'gpx') {
            newEvent = await EventImporterGPX.getFromString(fileReaderResult);
          } else if ((fileReaderResult instanceof ArrayBuffer) && metaData.extension === 'fit') {
            newEvent = await EventImporterFIT.getFromArrayBuffer(fileReaderResult);
          } else {
            resolve();
            return;
          }
          newEvent.name = metaData.filename;
        } catch (e) {
          metaData.status = UPLOAD_STATUS.ERROR;
          Sentry.captureException(e);
          this.logger.error(`Could not load event from file`, e);
          reject(); // no-op here!
          return;
        }
        try {
          await this.eventService.writeAllEventData(this.user, newEvent);
          this.afa.logEvent('upload_file', {method: metaData.extension});
          metaData.status = UPLOAD_STATUS.PROCESSED;
        } catch (e) {
          // debugger;
          console.error(e);
          Sentry.captureException(e);
          metaData.status = UPLOAD_STATUS.ERROR;
          reject();
          return;
        }
        resolve(newEvent);
      };
      // Read it depending on the extension
      if (metaData.extension === 'fit') {
        // Fit files should be read as array buffers
        fileReader.readAsArrayBuffer(metaData.file);
      } else {
        // All other as text
        fileReader.readAsText(metaData.file);
      }
    });
  }
}
