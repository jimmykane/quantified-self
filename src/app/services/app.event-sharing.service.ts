import { Clipboard } from '@angular/cdk/clipboard';
import { Injectable } from '@angular/core';
import { User } from '@sports-alliance/sports-lib';

import { AppFunctionsService } from './app.functions.service';
import { AppWindowService } from './app.window.service';

export type EventShareKind = 'event' | 'comparison';
export type EventPrivacy = 'public' | 'private';

export interface SetEventSharingRequest {
  userID: string;
  eventID: string;
  enabled: boolean;
}

export interface SetEventSharingResponse {
  eventID: string;
  privacy: EventPrivacy;
  publicEventUrl: string;
  publicComparisonUrl: string;
}

@Injectable({
  providedIn: 'root',
})
export class AppEventSharingService {
  constructor(
    private functionsService: AppFunctionsService,
    private clipboard: Clipboard,
    private windowService: AppWindowService,
  ) { }

  buildSharePath(kind: EventShareKind, userID: string, eventID: string): string {
    return `/share/${kind}/${encodeURIComponent(userID)}/${encodeURIComponent(eventID)}`;
  }

  buildShareUrl(kind: EventShareKind, userID: string, eventID: string): string {
    return `${this.windowService.currentDomain}${this.buildSharePath(kind, userID, eventID)}`;
  }

  async setEventSharing(user: User, eventID: string, enabled: boolean): Promise<SetEventSharingResponse> {
    const userID = `${user?.uid || ''}`.trim();
    const normalizedEventID = `${eventID || ''}`.trim();
    if (!userID || !normalizedEventID) {
      throw new Error('User and event are required to update sharing.');
    }

    const response = await this.functionsService.call<SetEventSharingRequest, SetEventSharingResponse>('setEventSharing', {
      userID,
      eventID: normalizedEventID,
      enabled,
    });

    return response.data;
  }

  copyShareUrl(kind: EventShareKind, userID: string, eventID: string): boolean {
    return this.clipboard.copy(this.buildShareUrl(kind, userID, eventID));
  }
}
