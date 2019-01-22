import {Injectable, OnDestroy} from '@angular/core';
import {Log} from 'ng2-logger/browser';
import {AngularFirestore, AngularFirestoreDocument} from '@angular/fire/firestore';
import {Observable} from 'rxjs';
import {User} from 'quantified-self-lib/lib/users/user';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {EventService} from './app.event.service';
import {map, take} from 'rxjs/operators';
import {AppThemes, UserAppSettingsInterface} from "quantified-self-lib/lib/users/user.app.settings.interface";
import {
  ChartThemes,
  DataTypeSettings,
  UserChartSettingsInterface
} from "quantified-self-lib/lib/users/user.chart.settings.interface";
import {DynamicDataLoader} from "quantified-self-lib/lib/data/data.store";
import {UserSettingsInterface} from "quantified-self-lib/lib/users/user.settings.interface";
import {
  PaceUnits,
  SpeedUnits,
  UserUnitSettingsInterface
} from "quantified-self-lib/lib/users/user.unit.settings.interface";


@Injectable()
export class UserService implements OnDestroy {

  protected logger = Log.create('UserService');

  constructor(
    private afs: AngularFirestore,
    private eventService: EventService,
  ) {
  }

  public getUserByID(userID: string): Observable<User> {
    return this.afs
      .collection('users')
      .doc<User>(userID)
      .valueChanges().pipe(map((user: User) => {
        if (!user) {
          return null
        }
        user.settings = this.fillMissingAppSettings(user);
        return user
      }));
  }

  public async createOrUpdateUser(user: User) {
    if (!user.acceptedPrivacyPolicy || !user.acceptedDataPolicy) {
      throw "User has not accepted privacy or data policy";
    }
    const userRef: AngularFirestoreDocument = this.afs.doc(
      `users/${user.uid}`,
    );
    await userRef.set(user.toJSON());
    return Promise.resolve(user);
  }

  public async updateUserProperties(user: User, propertiesToUpdate: any) {
    return this.afs.collection('users').doc(user.uid).update(propertiesToUpdate);
  }

  public async setUserPrivacy(user: User, privacy: Privacy) {
    return this.updateUserProperties(user, {privacy: privacy});
  }

  public async deleteAllUserData(user: User) {
    //
    const events = await this.eventService.getEventsForUser(user, null, 'startDate', false, 0).pipe(take(1)).toPromise();
    const promises = [];
    events.forEach((event) => {
      promises.push(this.eventService.deleteAllEventData(user, event.getID()));
    });
    // @todo add try catch here if some events fail to delete
    await Promise.all(promises);
    return this.afs.collection('users').doc(user.uid).delete();
  }



  private getDefaultUserChartSettingsDataTypeSettings(): DataTypeSettings {
    return DynamicDataLoader.basicDataTypes.reduce((dataTypeSettings: DataTypeSettings, dataTypeToUse: string) => {
      dataTypeSettings[dataTypeToUse] = {enabled: true};
      return dataTypeSettings
    }, {})
  }

  private fillMissingAppSettings(user: User): UserSettingsInterface {
    const settings: UserSettingsInterface = user.settings || {};
    settings.appSettings = settings.appSettings || <UserAppSettingsInterface>{};
    settings.appSettings.theme = settings.appSettings.theme || AppThemes.Normal;
    settings.chartSettings = settings.chartSettings || <UserChartSettingsInterface>{};
    settings.chartSettings.dataTypeSettings = settings.chartSettings.dataTypeSettings || this.getDefaultUserChartSettingsDataTypeSettings();
    settings.chartSettings.theme = settings.chartSettings.theme || ChartThemes.Material;
    settings.chartSettings.useAnimations = !!settings.chartSettings.useAnimations;
    settings.unitSettings = settings.unitSettings || <UserUnitSettingsInterface>{};
    settings.unitSettings.speedUnits = settings.unitSettings.speedUnits || [SpeedUnits.MetersPerSecond];
    settings.unitSettings.paceUnits = settings.unitSettings.paceUnits || [PaceUnits.MinutesPerKilometer];
    return settings;
  }

  ngOnDestroy() {
  }

}
