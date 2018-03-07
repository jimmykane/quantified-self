import {Component} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';

@Component({
    selector: 'app-upload',
    templateUrl: './upload.component.html',
    styleUrls: ['./upload.component.css'],
})

export class UploadComponent {

    //whether an upload is currently active
    isUploadActive: boolean = false;

    constructor(private eventService: EventService, private router: Router) {
    }

    /**
     * Process each uploaded activity
     * @param file
     * @returns {Promise}
     */
    processFile(file):Promise{
        return new Promise((resolve, reject) => {
            const fileReader = new FileReader;
            fileReader.onload = async () => {
                const {name} = file,
                      extension = name.split('.').pop(),
                      activityName = name.split('.')[0];
                if (extension === 'json') {
                    let newEvent;
                    try {
                        newEvent = await this.eventService.createEventFromSuuntoJSONString(fileReader.result);
                    }catch(error) {
                        console.error('Could not load event from file' + file.name, error);
                        reject(error);
                        return;
                    }
                    newEvent.setName(activityName);
                    await this.eventService.generateGeoAndWeather(newEvent)
                    this.eventService.saveEvent(newEvent);
                    resolve();
                }
            };
            // Read it
            fileReader.readAsText(file);
        });
    }

    async openFile(event): void {
        this.isUploadActive = true;
        const input = event.target;
        const processPromises = [];
        for (let index = 0; index < input.files.length; index++) {
            processPromises.push(this.processFile(input.files[index]));
        }
        try{
          await Promise.all(processPromises);
          this.router.navigate(['dashboard']);
        }catch(error){
            console.error('Some of the files could not be processed', error);
        }finally{
            this.isUploadActive = false;
        }
    }
}
