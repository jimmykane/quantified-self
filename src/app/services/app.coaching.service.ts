import {Injectable} from '@angular/core';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { AngularFirestore } from '@angular/fire/firestore';
import { map, switchMap } from 'rxjs/operators';
import { combineLatest, Observable } from 'rxjs';
import { AppUserService } from './app.user.service';


@Injectable({
  providedIn: 'root',
})
export class AppCoachingService {

  constructor(
    private afs: AngularFirestore,
    private userService: AppUserService
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
}
