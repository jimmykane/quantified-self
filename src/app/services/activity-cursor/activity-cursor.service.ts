import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs';
import {Log} from 'ng2-logger/browser';

@Injectable()
export class ActivityCursorService {
  public cursors: BehaviorSubject<ActivityCursorInterface[]> = new BehaviorSubject([]);

  private logger = Log.create('ActivityCursorService');

  constructor() {
  }

  public setCursor(cursor: ActivityCursorInterface) {
    const activityCursor = this.cursors.getValue().find(c => c.activityID === cursor.activityID);
    // If there is no current cursor then justs add it and return
    if (!activityCursor) {
      this.cursors.getValue().push(cursor);
      this.cursors.next(this.cursors.getValue());
      return;
    }
    // Noop if the cursor is the same
    if (activityCursor.time === cursor.time) {
      this.logger.info(`Noop for ${cursor.time}`);
      return;
    }
    // Now update the time
    activityCursor.time = cursor.time;
    this.cursors.next(this.cursors.getValue());
  }

  public removeCursor(cursor: ActivityCursorInterface) {
    const index = this.cursors.getValue().findIndex(activityCursor => activityCursor.activityID === cursor.activityID);
    this.cursors.getValue().splice(index, 1);
    this.cursors.next(this.cursors.getValue());
  }

  public clear() {
    this.cursors.next([]);
  }
}


export interface ActivityCursorInterface {
  activityID: string
  time: number;
}
