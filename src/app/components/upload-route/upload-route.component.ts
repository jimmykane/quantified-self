import { Component, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import { UploadErrorComponent } from '../upload-error/upload-error.component';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { Log } from 'ng2-logger/browser';
import { AngularFireAnalytics } from '@angular/fire/analytics';
import { UPLOAD_STATUS } from '../upload-status/upload.status';
import { environment } from '../../../environments/environment';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AngularFireAuth } from '@angular/fire/auth';
import { FileMetaData } from '../upload/upload.component';
import { AppEventService } from '../../services/app.event.service';

@Component({
  selector: 'app-upload-route',
  templateUrl: './upload-route.component.html',
  styleUrls: ['./upload-route.component.css'],
})

export class UploadRouteComponent implements OnInit {

  @Input() user: User;

  // Whether an upload is currently active
  isUploadActive = false;
  activitiesMetaData: FileMetaData[] = [];

  protected logger = Log.create('UploadRouteComponent');


  constructor(
    private snackBar: MatSnackBar,
    public dialog: MatDialog,
    private http: HttpClient,
    private afAuth: AngularFireAuth,
    private eventService: AppEventService,
    private afa: AngularFireAnalytics,
    private router: Router) {
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error('This component can only be used with a user')
    }
  }

  /**
   * Process each uploaded GPX
   * @returns {Promise}
   * @param metaData
   */
  async uploadRouteFromFile(metaData: FileMetaData) {
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader;
      fileReader.onload = async () => {
        if (!(typeof fileReader.result === 'string') || metaData.extension !== 'gpx') {
          reject(`Not a GPX file`)
        }
        try {
          const result = await this.http.post(environment.functions.uploadRoute,
            fileReader.result,
            {
              headers:
                new HttpHeaders({
                  'Authorization': await (await this.afAuth.currentUser).getIdToken(true)
                })
            }).toPromise();
        } catch (e) {
          Sentry.captureException(e);
          this.snackBar.open(`Could not upload ${metaData.filename}, reason: ${e.message}`);
          reject(`Could not upload ${metaData.filename}, reason: ${e.message}`);
          return;
        }
        resolve();
      }

      // Read it depending on the extension
      if (metaData.extension === 'gpx') {
        fileReader.readAsText(metaData.file);
      } else {
        resolve();
      }
    })
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
        await this.uploadRouteFromFile(this.activitiesMetaData[index]);
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
