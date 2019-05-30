import {Injectable} from '@angular/core';
import {UserService} from './app.user.service';
import {AngularFirestore} from '@angular/fire/firestore';
import {BehaviorSubject, Observable} from 'rxjs';
import {environment} from '../../environments/environment';


@Injectable()
export class AppInfoService {

  private appVersions: BehaviorSubject<{beta: string, production: string}> = new BehaviorSubject(null);

  constructor(
    private userService: UserService,
    private afs: AngularFirestore
  ) {
    this.afs.collection('appInfo').doc('version').valueChanges().subscribe((doc: {beta: string, production: string}) => {
      this.appVersions.next(doc);
    })
  }

  getAppVersions(): Observable<{beta: string, production: string}> {
    return this.appVersions.asObservable()
  }

}
