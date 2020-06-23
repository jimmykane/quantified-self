import {Injectable, NgZone} from '@angular/core';


@Injectable({
  providedIn: 'root',
})
export class AppWindowService {

  get windowRef() {
    return window
  }

  get currentDomain() {
    return `${this.windowRef.location.protocol}//${this.windowRef.location.host}`
  }

}
