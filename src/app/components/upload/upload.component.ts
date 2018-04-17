import {Component} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';
import {UPLOAD_STATUS} from './status';
import {MatSnackBar} from '@angular/material';
import {EventImporterSuuntoJSON} from '../../entities/events/adapters/importers/suunto/importer.suunto.json';
import {EventImporterTCX} from '../../entities/events/adapters/importers/importer.tcx';
import {EventInterface} from '../../entities/events/event.interface';

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
          }
          newEvent.name = activityName;
          await this.eventService.addGeoLocationAndWeatherInfo(newEvent);
          metaData.status = UPLOAD_STATUS.PROCESSED;
          this.eventService.addAndSaveEvent(newEvent);
          resolve(newEvent);
        } catch (error) {
          metaData.status = UPLOAD_STATUS.ERROR;
          console.error('Could not load event from file' + file.name, error);
          reject(error);
        }
      };
      // Read it
      fileReader.readAsText(file);
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
    try {
      await Promise.all(processPromises);
      this.router.navigate(['dashboard']).then(() => {
        this.snackBar.open('Processing complete!', null, {
          duration: 5000,
        });
      });
    } catch (error) {
      console.error('Some of the files could not be processed', error);
    } finally {
      // Pass event to removeDragData for cleanup
      if (event.dataTransfer && event.dataTransfer.items) {
        // Use DataTransferItemList interface to remove the drag data
        event.dataTransfer.items.clear();
      } else if (event.dataTransfer) {
        // Use DataTransfer interface to remove the drag data
        event.dataTransfer.clearData();
      }
    }
  }
}
