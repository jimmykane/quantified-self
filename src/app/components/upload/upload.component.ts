import {Component} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';
import {UPLOAD_STATUS} from './status';
import {MatSnackBar} from '@angular/material';
import {EventUtilities} from '../../entities/events/utilities/event.utilities';
import {EventImporterSuuntoJSON} from "../../entities/events/adapters/importers/suunto/importer.suunto.json";
import {EventImporterTCX} from "../../entities/events/adapters/importers/importer.tcx";

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
  processFile(file): Promise<any> {
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
          await this.eventService.generateGeoAndWeather(newEvent);
          metaData.status = UPLOAD_STATUS.PROCESSED;
          this.eventService.addAndSaveEvent(newEvent);
          resolve();

        } catch (error) {
          metaData.status = UPLOAD_STATUS.ERROR;
          console.error('Could not load event from file' + file.name, error);
          reject(error);
          return;
        }
      };
      // Read it
      fileReader.readAsText(file);
    });
  }

  async openFile(event) {
    this.isUploadActive = true;
    const input = event.target;
    const processPromises = [];
    for (let index = 0; index < input.files.length; index++) {
      processPromises.push(this.processFile(input.files[index]));
    }
    try {
      await Promise.all(processPromises);
      this.router.navigate(['dashboard']);
      this.snackBar.open('Processing complete!', null, {
        duration: 5000,
      });
    } catch (error) {
      console.error('Some of the files could not be processed', error);
    } finally {
      this.isUploadActive = false;
    }
  }

  async dropHandler(event) {
    console.log('File(s) dropped');
    // Prevent default behavior (Prevent file from being opened)
    event.preventDefault();

    const filesToProcess = [];

    if (event.dataTransfer.items) {
      // Use DataTransferItemList interface to access the file(s)
      for (let i = 0; i < event.dataTransfer.items.length; i++) {
        // If dropped items aren't files, reject them
        if (event.dataTransfer.items[i].kind === 'file') {
          debugger;
          const file = event.dataTransfer.items[i].getAsFile();
          console.log('... file[' + i + '].name = ' + file.name);
        }
      }
    } else {
      // Use DataTransfer interface to access the file(s)
      for (let i = 0; i < event.dataTransfer.files.length; i++) {
        debugger;
        console.log('... file[' + i + '].name = ' + event.dataTransfer.files[i].name);
      }
    }

    // Pass event to removeDragData for cleanup
    console.log('Removing drag data')

    if (event.dataTransfer.items) {
      // Use DataTransferItemList interface to remove the drag data
      event.dataTransfer.items.clear();
    } else {
      // Use DataTransfer interface to remove the drag data
      event.dataTransfer.clearData();
    }
  }
}
