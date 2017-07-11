import {Injectable} from '@angular/core';
import {ActionButton} from './app.action-button';
import {BehaviorSubject} from 'rxjs/BehaviorSubject';
import {Observable} from 'rxjs/Observable';

@Injectable()
export class ActionButtonService {

  private actionButtons: BehaviorSubject<Map<string, ActionButton>> = new BehaviorSubject(new Map<string, ActionButton>());

  constructor() {
  }

  getActionButtons(): Observable<Map<string, ActionButton>> {
    return this.actionButtons.asObservable();
  };

  addActionButton(name: string, actionButton: ActionButton) {
    this.actionButtons.next(this.actionButtons.getValue().set(name, actionButton));
  }

  removeActionButton(name: string) {
    this.actionButtons.getValue().delete(name);
    this.actionButtons.next(this.actionButtons.getValue());
  }
}
