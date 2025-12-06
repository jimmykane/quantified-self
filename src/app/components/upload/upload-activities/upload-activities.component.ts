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
import { EventImporterSuuntoSML } from '@sports-alliance/sports-lib/lib/events/adapters/importers/suunto/importer.suunto.sml';
import { AngularFireAnalytics } from '@angular/fire/compat/analytics';
import { UploadAbstractDirective } from '../upload-abstract.directive';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { AppFilesStatusService } from '../../../services/upload/app-files-status.service';
import { Overlay } from '@angular/cdk/overlay';

@Component({
    selector: 'app-upload-activities',
    templateUrl: './upload-activities.component.html',
    styleUrls: ['../upload-abstract.css', './upload-activities.component.css'],
    standalone: false
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
    super(snackBar, dialog, filesStatusService)
  }

  processAndUploadFile(file): Promise<EventInterface> {
    this.afa.logEvent('upload_file', {method: file.extension});
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
            reject(new Error('No compatible parser found'))
            return;
          }
          newEvent.name = file.filename;
        } catch (e) {
          this.snackBar.open(`Could not upload ${file.filename}.${file.extension}, reason: ${e.message}`, 'OK', {duration: 2000});
          reject(e); // no-op here!
          return;
        }
        try {
          await this.eventService.writeAllEventData(this.user, newEvent);
        } catch (e) {
          this.snackBar.open(`Could not upload ${file.filename}, reason: ${e.message}`);
          reject(e);
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
