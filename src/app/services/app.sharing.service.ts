import {Injectable} from '@angular/core';
import { AppWindowService } from './app.window.service';


@Injectable({
  providedIn: 'root',
})
export class AppSharingService {
  constructor(private windowService: AppWindowService) {
  }
  public getShareURLForEvent(userID: string, eventID: string): string {
    return `${this.windowService.currentDomain}/user/${userID}/event/${eventID}`;
  }

  public getShareURLForUser(userID: string): string {
    return `${this.windowService.currentDomain}/user/${userID}`;
  }
}
