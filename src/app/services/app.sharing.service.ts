import {Injectable} from '@angular/core';


@Injectable()
export class SharingService {
  public getShareURLForEvent(userID: string, eventID: string): string {
    return `${window.location.protocol}//${window.location.host}/user/${userID}/event/${eventID}`;
  }
}
