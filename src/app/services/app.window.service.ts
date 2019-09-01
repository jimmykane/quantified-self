import {Injectable, NgZone} from '@angular/core';


@Injectable()
export class WindowService {

  get windowRef() {
    return window
  }

}
