import { Injectable, inject } from '@angular/core';
import { User } from '@sports-alliance/sports-lib';
import { Firestore, collection, collectionData } from '@angular/fire/firestore';
import { map, switchMap } from 'rxjs/operators';
import { combineLatest, Observable } from 'rxjs';
import { AppUserService } from './app.user.service';
import { AppEventService } from './app.event.service';
import { DateRanges } from '@sports-alliance/sports-lib';
import { DaysOfTheWeek } from '@sports-alliance/sports-lib';
import { getDatesForDateRange } from '../helpers/date-range-helper';
import { WhereFilterOp } from 'firebase/firestore';


@Injectable({
  providedIn: 'root',
})
export class AppCoachingService {

  private firestore = inject(Firestore);

  constructor(
    private userService: AppUserService,
    private eventService: AppEventService
  ) {
  }

  public getCoachedAthletesForUser(user: User): Observable<User[]> {
    const athletesCollection = collection(this.firestore, 'coaches', user.uid, 'athletes');
    return collectionData(athletesCollection, { idField: 'id' })
      .pipe(map((documents: any[]) => {
        return documents.map(doc => doc.id);
      })).pipe(switchMap((userIDS) => {
        if (userIDS.length === 0) {
          return new Observable<User[]>((subscriber) => subscriber.next([]));
        }
        return combineLatest(userIDS.map((userID) => {
          return this.userService.getUserByID(userID);
        }));
      }))
  }

  getUserEventsForDateRange(user: User, dateRange: DateRanges, startOfTheWeek: DaysOfTheWeek) {
    const searchStartDate = getDatesForDateRange(dateRange, startOfTheWeek).startDate;
    const searchEndDate = getDatesForDateRange(dateRange, startOfTheWeek).endDate;
    const where = [
      {
        fieldPath: 'startDate',
        opStr: <WhereFilterOp>'>=',
        value: searchStartDate.getTime() // Should remove mins from date
      }, {
        fieldPath: 'startDate',
        opStr: <WhereFilterOp>'<=', // Should remove mins from date
        value: searchEndDate.getTime()
      }];
    return this.eventService.getEventsBy(user, where, 'startDate', false, 0);
  }
}
