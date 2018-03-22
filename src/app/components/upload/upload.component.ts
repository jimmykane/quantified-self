import {Component} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';
import {ListService} from '../../services/info-list/list.service';

@Component({
  selector: 'app-upload',
  templateUrl: './upload.component.html',
  styleUrls: ['./upload.component.css'],
})

export class UploadComponent {

  // Whether an upload is currently active
  isUploadActive = false;
  activitiesProcessed = [];

  constructor(private eventService: EventService,
              private router: Router, private listService: ListService) {
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
        activityName = nameParts.join('.');
      const item = this.listService.addItem(`Processing ${activityName}`);
      fileReader.onload = async () => {
        if (extension === 'json') {
          let newEvent;
          try {
            newEvent = await this.eventService.createEventFromSuuntoJSONString(fileReader.result);
          } catch (error) {
            console.error('Could not load event from file' + file.name, error);
            item.update(`Error while processing ${activityName}`);
            reject(error);
            item.remove();
            return;
          }
          newEvent.name = activityName;
          await this.eventService.generateGeoAndWeather(newEvent);
          this.eventService.addAndSaveEvent(newEvent);
          item.update(`Finished ${activityName}`);
          item.remove();
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
    } catch (error) {
      console.error('Some of the files could not be processed', error);
    } finally {
      this.isUploadActive = false;
    }
  }
}
