import {Injectable, OnDestroy} from '@angular/core';
import {Log} from 'ng2-logger';
import {AngularFirestore} from '@angular/fire/firestore';
import {Observable} from 'rxjs';
import {User} from 'quantified-self-lib/lib/users/user';


@Injectable()
export class EventService implements OnDestroy {

  protected logger = Log.create('UserService');

  constructor(
    private afs: AngularFirestore) {
  }

  public getUser(userID: string): Observable<User> {
    return this.afs
      .collection('users')
      .doc<User>(userID)
      .valueChanges();
  }

  ngOnDestroy() {
  }

}
