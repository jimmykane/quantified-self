import {Component} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';
import {UPLOAD_STATUS} from './status';
import {MatSnackBar} from '@angular/material';
import {EventImporterSuuntoJSON} from '../../entities/events/adapters/importers/suunto/importer.suunto.json';
import {EventImporterTCX} from '../../entities/events/adapters/importers/importer.tcx';
import {EventInterface} from '../../entities/events/event.interface';
import {EventImporterFIT} from "../../entities/events/adapters/importers/fit/importer.fit";

@Component({
  selector: 'app-upload',
  templateUrl: './upload.component.html',
  styleUrls: ['./upload.component.css'],
})

export class UploadComponent {

  // Whether an upload is currently active
  isUploadActive = false;
  activitiesMetaData = [];

  constructor(private snackBar: MatSnackBar, private eventService: EventService, private router: Router) {
  }

  /**
   * Process each uploaded activity
   * @param file
   * @returns {Promise}
   */
  processFile(file): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader;
      const {name} = file,
        nameParts = name.split('.'),
        extension = nameParts.pop(),
        activityName = nameParts.join('.'),
        metaData = {
          name: activityName,
          status: UPLOAD_STATUS.PROCESSING
        };
      this.activitiesMetaData.push(metaData);
      fileReader.onload = async () => {
        let newEvent;
        try {
          if (extension === 'json') {
            newEvent = EventImporterSuuntoJSON.getFromJSONString(fileReader.result);
          } else if (extension === 'tcx') {
            newEvent = EventImporterTCX.getFromXML((new DOMParser()).parseFromString(fileReader.result, 'application/xml'));
          } else if (extension === 'fit') {
            newEvent = await EventImporterFIT.getFromArrayBuffer(fileReader.result);
          }
          newEvent.name = activityName;
          await this.eventService.addGeoLocationAndWeatherInfo(newEvent);
          metaData.status = UPLOAD_STATUS.PROCESSED;
          this.eventService.addAndSaveEvent(newEvent);
          resolve(newEvent);
        } catch (error) {
          metaData.status = UPLOAD_STATUS.ERROR;
          console.error('Could not load event from file' + file.name, error); // Should check with Sentry
          resolve(); // no-op here!
        }
      };
      // Read it depending on the extension
      if (extension === 'fit') {
        // Fit files should be read as array buffers
        fileReader.readAsArrayBuffer(file);
      } else {
        // All other as text
        fileReader.readAsText(file);
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
    const processPromises = [];
    for (let index = 0; index < files.length; index++) {
      processPromises.push(this.processFile(files[index]));
    }
    await Promise.all(processPromises);
    this.isUploadActive = false;
    this.snackBar.open('Processed ' + processPromises.length + ' files', null, {
      duration: 5000,
    });
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
