import {Component} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';
import {LocalStorageService} from '../../services/storage/app.local.storage.service';
import {EventInterface} from '../../entities/events/event.interface';

@Component({
  selector: 'app-upload',
  templateUrl: './upload.component.html',
  styleUrls: ['./upload.component.css'],
})

export class UploadComponent {

  //whether an upload is currently active
  isUploadActive: boolean;

  constructor(private eventService: EventService, private localStorageService: LocalStorageService, private router: Router) {
    this.isUploadActive = false;
  }

  openFile(event): void {
    this.isUploadActive = true;
    const input = event.target;
    for (let index = 0; index < input.files.length; index++) {
      const fileReader = new FileReader;
      fileReader.onload = () => {
        const name = input.files[index].name.split('.')[0];
        if (['tcx', 'gpx'].indexOf(input.files[index].name.split('.').pop()) > -1) {
          this.eventService
            .createEventFromXMLString(fileReader.result)
            .then((newEvent: EventInterface) => {
              newEvent.setName(name);
              this.eventService.generateEventSummaries(newEvent).then((newEventWithSummaries: EventInterface) => {
                this.eventService.saveEvent(newEventWithSummaries);
                this.isUploadActive = false;
                this.router.navigate(['dashboard']);
              });
            })
            .catch((error) => {
              this.isUploadActive = false;
              console.error('Could not load event from file' + input.files[index].name, error);
            });
        } else if (input.files[index].name.split('.').pop() === 'fit') {
          this.readAsBinary(input.files[index]);
        } else if (input.files[index].name.split('.').pop() === 'json') {
          this.eventService
            .createEventFromSuuntoJSONString(fileReader.result)
            .then((newEvent: EventInterface) => {
              newEvent.setName(name);
              this.eventService.generateGeoAndWeather(newEvent).then(() => {
                this.eventService.saveEvent(newEvent);
                this.isUploadActive = false;
                this.router.navigate(['dashboard']);
              });
            })
            .catch((error) => {
              this.isUploadActive = false;
              console.error('Could not load event from file' + input.files[index].name, error);
            });
        }
      };
      // Read it
      fileReader.readAsText(input.files[index]);
    }
  }

  // @todo refactor
  private readAsBinary(file: File) {
    const fileReader = new FileReader;
    fileReader.onloadend = (ev: ProgressEvent) => {
      this.eventService
        .createEventFromJSONFITString(fileReader.result)
        .then((newEvent: EventInterface) => {
          newEvent.setName(file.name.split('.')[0]);
          this.eventService.generateEventSummaries(newEvent).then((newEventWithSummaries: EventInterface) => {
            this.eventService.saveEvent(newEventWithSummaries);
          });
        })
        .catch((error) => {
          console.error('Could not load event from file' + file.name, error);
        });
    };
    fileReader.readAsArrayBuffer(file);

  }
}
