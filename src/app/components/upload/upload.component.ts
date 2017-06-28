import {Component} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';
import {LocalStorageService} from '../../services/app.local.storage.service';
import {EventInterface} from '../../entities/events/event.interface';

@Component({
  selector: 'app-upload',
  templateUrl: './upload.component.html',
  styleUrls: ['./upload.component.css'],
})

export class UploadComponent {
  public title = 'Upload some TCX or GPX files';

  constructor(private eventService: EventService, private localStorageService: LocalStorageService, private router: Router) {
  }

  openFile(event): void {
    const input = event.target;
    for (let index = 0; index < input.files.length; index++) {
      const fileReader = new FileReader;
      fileReader.onload = () => {
        if (['tcx', 'gpx'].indexOf(input.files[index].name.split('.').pop()) > -1) {
          this.eventService
            .createEventFromXMLString(fileReader.result)
            .then((newEvent: EventInterface) => {
              newEvent.setName(input.files[index].name);
              this.eventService.saveEvent(newEvent);
            })
            .catch((error) => {
              console.error('Could not load event from file' + input.files[index].name, error);
            });
        } else if (input.files[index].name.split('.').pop() === 'fit') {
          this.readAsBinary(input.files[index]);
        } else if (input.files[index].name.split('.').pop() === 'json') {
          this.eventService
            .createEventFromJSONSMLString(fileReader.result)
            .then((newEvent: EventInterface) => {
              newEvent.setName(input.files[index].name);
              this.eventService.saveEvent(newEvent);
            })
            .catch((error) => {
              console.error('Could not load event from file' + input.files[index].name, error);
            });
        }
      };
      // Read it
      fileReader.readAsText(input.files[index]);
    }
    this.router.navigate(['dashboard']);
  }

  // @todo refactor
  private readAsBinary(file: File) {
    const fileReader = new FileReader;
    fileReader.onloadend = (ev: ProgressEvent) => {
      this.eventService
        .createEventFromJSONFITString(fileReader.result)
        .then((newEvent: EventInterface) => {
          newEvent.setName(file.name);
          this.eventService.saveEvent(newEvent);
        })
        .catch((error) => {
          console.error('Could not load event from file' + file.name, error);
        });
    };
    fileReader.readAsArrayBuffer(file);

  }
}
