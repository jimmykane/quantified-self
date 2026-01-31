import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AppActivityCursorService {
  public cursors: BehaviorSubject<ActivityCursorInterface[]> = new BehaviorSubject<ActivityCursorInterface[]>([]);



  constructor() {
  }

  public setCursor(cursor: ActivityCursorInterface) {
    // console.log('AppActivityCursorService: setCursor', cursor);
    const activityCursor = this.cursors.getValue().find(c => c.activityID === cursor.activityID);
    // If there is no current cursor then justs add it and return
    if (!activityCursor) {
      this.cursors.getValue().push(cursor);
      this.cursors.next(this.cursors.getValue());
      return;
    }
    // Noop if the cursor is the same
    if (activityCursor.time === cursor.time) {
      //
      return;
    }
    // Now update the time
    activityCursor.time = cursor.time;
    activityCursor.byChart = cursor.byChart;
    activityCursor.byMap = cursor.byMap;
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
  byChart?: boolean;
  byMap?: boolean;
}
