import { Component } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import { Log } from 'ng2-logger/browser';
import { AngularFireAnalytics } from '@angular/fire/analytics';
import { environment } from '../../../../environments/environment';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AngularFireAuth } from '@angular/fire/auth';
import { UploadAbstractDirective } from '../upload-abstract.directive';
import { FileInterface } from '../file.interface';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { AppFilesStatusService } from '../../../services/upload/app-files-status.service';

@Component({
  selector: 'app-upload-route',
  templateUrl: './upload-routes.component.html',
  styleUrls: ['./upload-routes.component.css'],
})

export class UploadRoutesComponent extends UploadAbstractDirective {

  constructor(
    protected snackBar: MatSnackBar,
    protected dialog: MatDialog,
    protected bottomSheet: MatBottomSheet,
    protected filesStatusService: AppFilesStatusService,
    private http: HttpClient,
    private afAuth: AngularFireAuth,
    private afa: AngularFireAnalytics) {
    super(snackBar, dialog, bottomSheet, filesStatusService, Log.create('UploadRouteComponent'));
  }

  /**
   * Process each uploaded GPX
   * @returns {Promise}
   * @param metaData
   */
  async processAndUploadFile(metaData: FileInterface) {
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader;
      fileReader.onload = async () => {
        if (!(typeof fileReader.result === 'string')) {
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
        reject('Unknown file type');
      }
    })
  }
}
