import {Component, Input, OnInit} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';
import {MatDialog} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventImporterSuuntoJSON} from 'quantified-self-lib/lib/events/adapters/importers/suunto/importer.suunto.json';
import {EventImporterFIT} from 'quantified-self-lib/lib/events/adapters/importers/fit/importer.fit';
import {EventImporterTCX} from 'quantified-self-lib/lib/events/adapters/importers/tcx/importer.tcx';
import {EventImporterGPX} from 'quantified-self-lib/lib/events/adapters/importers/gpx/importer.gpx';
import {UploadErrorComponent} from '../upload-error/upload-error.component';
import {User} from 'quantified-self-lib/lib/users/user';
import {UPLOAD_STATUS} from './upload.status';
import {Log} from 'ng2-logger/browser';
import {EventImporterSuuntoSML} from 'quantified-self-lib/lib/events/adapters/importers/suunto/importer.suunto.sml';

@Component({
  selector: 'app-upload',
  templateUrl: './upload.component.html',
  styleUrls: ['./upload.component.css'],
})

export class UploadComponent implements OnInit {

  @Input() user: User;

  // Whether an upload is currently active
  isUploadActive = false;
  activitiesMetaData = [];

  protected logger = Log.create('UploadComponent');


  constructor(
    private snackBar: MatSnackBar,
    public dialog: MatDialog,
    private eventService: EventService,
    private router: Router) {
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error('This component can only be used with a user')
    }
  }

  /**
   * Process each uploaded activity
   * @returns {Promise}
   * @param metaData
   */
  processFile(metaData): Promise<EventInterface> {
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
          await this.eventService.setEvent(this.user, newEvent);
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

  /**
   * Get's the files and resolves their processing promises
   * @param event
   * @return {Promise<void>}
   */
  async getFiles(event) {
    event.stopPropagation();
    event.preventDefault();

    this.isUploadActive = true;
    const files = event.target.files || event.dataTransfer.files;

    // First create the metadata on a single loop so subcomponents can get updated
    for (let index = 0; index < files.length; index++) {
      this.activitiesMetaData.push({
        file: files[index],
        name: files[index].name,
        status: UPLOAD_STATUS.PROCESSING,
        extension: files[index].name.split('.').pop().toLowerCase(),
        filename: files[index].name.split('.').shift(),
      });
    }

    // Then actually start processing them
    for (let index = 0; index < this.activitiesMetaData.length; index++) {
      try {
        await this.processFile(this.activitiesMetaData[index]);
      } catch (e) {
        this.logger.error(e);
        Sentry.captureException(e);
      }
    }

    this.isUploadActive = false;
    this.snackBar.open('Processed ' + this.activitiesMetaData.length + ' files', null, {
      duration: 2000,
    });

    // If there is an error show a modal
    if (this.activitiesMetaData.filter(activityMetaData => activityMetaData.status === UPLOAD_STATUS.ERROR).length) {
      const dialogRef = this.dialog.open(UploadErrorComponent, {
        width: '75vw',
        disableClose: false,
        data: {activitiesMetaData: this.activitiesMetaData},
      });
      // dialogRef.afterClosed().subscribe(result => {
      //   console.log('The dialog was closed');
      // });
    }

    // Remove all;
    this.activitiesMetaData = [];
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
