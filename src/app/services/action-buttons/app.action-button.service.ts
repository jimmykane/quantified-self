import {Injectable} from '@angular/core';
import {ActionButton} from './app.action-button';

@Injectable()
export class ActionButtonService {

  public actionButtons: Map<string, ActionButton> = new Map<string, ActionButton>();

  constructor() {
  }
}
