import {Injectable, NgZone} from '@angular/core';


@Injectable({
  providedIn: 'root',
})
export class AppWindowService {

  get windowRef() {
    return window
  }

}
