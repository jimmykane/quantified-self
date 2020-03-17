import {Injectable} from '@angular/core';
import {AppUserService} from './app.user.service';
import {AngularFirestore} from '@angular/fire/firestore';
import {BehaviorSubject, Observable} from 'rxjs';


@Injectable({
  providedIn: 'root',
})
export class AppInfoService {

  private appVersions: BehaviorSubject<{beta: string, production: string, localhost: string}> = new BehaviorSubject(null);

  constructor(
    private userService: AppUserService,
    private afs: AngularFirestore
  ) {
    this.afs.collection('appInfo').doc('version').snapshotChanges().subscribe((snapshot) => {
      if (snapshot.payload.metadata.fromCache){
        return;
      }
      this.appVersions.next(<{beta: string, production: string, localhost: string}>snapshot.payload.data());
    })
  }

  getAppVersions(): Observable<{beta: string, production: string, localhost: string}> {
    return this.appVersions.asObservable()
  }

}
