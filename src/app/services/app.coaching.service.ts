import { Injectable } from '@angular/core';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { map, switchMap } from 'rxjs/operators';
import { combineLatest, Observable } from 'rxjs';
import { AppUserService } from './app.user.service';
import { AppEventService } from './app.event.service';
import { DateRanges } from '@sports-alliance/sports-lib/lib/users/settings/dashboard/user.dashboard.settings.interface';
import { DaysOfTheWeek } from '@sports-alliance/sports-lib/lib/users/settings/user.unit.settings.interface';
import { getDatesForDateRange } from '../helpers/date-range-helper';
import firebase from 'firebase/compat/app';
import WhereFilterOp = firebase.firestore.WhereFilterOp;


@Injectable({
  providedIn: 'root',
})
export class AppCoachingService {

  constructor(
    private afs: AngularFirestore,
    private userService: AppUserService,
    private eventService: AppEventService
  ) {
  }

  public getCoachedAthletesForUser(user: User): Observable<User[]> {
    return this.afs
      .collection('coaches')
      .doc(user.uid)
      .collection('athletes')
      .snapshotChanges()// @todo use value changes for lighter operation
      .pipe(map((documentSnapshots) => {
        return documentSnapshots.reduce((idArray: string[], documentSnapshot) => {
          idArray.push(documentSnapshot.payload.doc.id);
          return idArray;
        }, [])
      })).pipe(switchMap((userIDS) => {
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
