import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs';

@Injectable()
export class ActivityCursorService {

  public cursors: BehaviorSubject<ActivityCursorInterface[]> = new BehaviorSubject([]);

  constructor() {
  }

  public setCursor(cursor: ActivityCursorInterface) {
    const activityCursor = this.cursors.getValue().find(cursor => cursor.activityID === cursor.activityID);
    // If there is no current cursor then justs add it and return
    if (!activityCursor) {
      this.cursors.getValue().push(cursor);
      this.cursors.next(this.cursors.getValue());
      return;
    }
    // Noop if the cursor is the same
    if (activityCursor.time === cursor.time) {
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
}


export interface ActivityCursorInterface {
  activityID: string
  time: number;
}
