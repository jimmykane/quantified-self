import {Injectable} from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { MatSnackBar } from '@angular/material/snack-bar';
import { interval } from 'rxjs';


@Injectable({
  providedIn: 'root',
})
export class AppUpdateService {
  constructor(private swUpdate: SwUpdate, private snackbar: MatSnackBar) {
    if (swUpdate.isEnabled) {
      interval(5 * 60 * 1000).subscribe(() => swUpdate.checkForUpdate()
        .then(() => console.log('checking for updates')));
    }
    this.swUpdate.available.subscribe(evt => {
      const snack = this.snackbar.open('There is a new version available', 'Reload');
      snack
        .onAction()
        .subscribe(() => {
          window.location.reload();
        });
    });
  }

}
