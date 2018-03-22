import {Component} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';
import {UPLOAD_STATUS} from './status';
import {MatSnackBar} from '@angular/material';
import {EventUtilities} from '../../entities/events/utilities/event.utilities';

@Component({
  selector: 'app-upload',
  templateUrl: './upload.component.html',
  styleUrls: ['./upload.component.css'],
})

export class UploadComponent {

  // Whether an upload is currently active
  isUploadActive = false;
  activitiesProcessed = [];

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
      this.activitiesProcessed.push(metaData);
      fileReader.onload = async () => {
        if (extension === 'json') {
          let newEvent;
          try {
            newEvent = await EventUtilities.createEventFromSuuntoJSONString(fileReader.result);
          } catch (error) {
            metaData.status = UPLOAD_STATUS.ERROR;
            console.error('Could not load event from file' + file.name, error);
            reject(error);
            return;
          }
          newEvent.name = activityName;
          await this.eventService.generateGeoAndWeather(newEvent);
          this.eventService.addAndSaveEvent(newEvent);
          metaData.status = UPLOAD_STATUS.PROCESSED;
          resolve();
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
}
