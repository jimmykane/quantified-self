import {Injectable} from '@angular/core';


@Injectable({
  providedIn: 'root',
})
export class AppSharingService {
  public getShareURLForEvent(userID: string, eventID: string): string {
    return `${window.location.protocol}//${window.location.host}/user/${userID}/event/${eventID}`;
  }

  public getShareURLForUser(userID: string): string {
    return `${window.location.protocol}//${window.location.host}/user/${userID}`;
  }
}
