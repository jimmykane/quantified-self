import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs';

@Injectable()
export class ActivityCursorService {

  public cursors: BehaviorSubject<ActivityCursorInterface[]> = new BehaviorSubject([]);

  constructor() {
  }

  public setCursor(cursor: ActivityCursorInterface) {
    const activityCursor = this.cursors.getValue().find(activityCursor => activityCursor.activityID === cursor.activityID);
    if (!activityCursor) {
      this.cursors.getValue().push(cursor);
    } else {
      activityCursor.time = cursor.time; // @todo not sure
    }
    this.cursors.next(this.cursors.getValue());
  }

  public removeCursor(cursor: ActivityCursorInterface){
    const index = this.cursors.getValue().findIndex(activityCursor => activityCursor.activityID === cursor.activityID);
    this.cursors.getValue().splice(index, 1);
    this.cursors.next(this.cursors.getValue());
  }
}


export interface ActivityCursorInterface {
  activityID: string
  time: number;
}
