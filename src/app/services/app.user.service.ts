import {Injectable, OnDestroy} from '@angular/core';
import {Log} from 'ng2-logger/browser';
import {AngularFirestore, AngularFirestoreDocument} from '@angular/fire/firestore';
import {Observable} from 'rxjs';
import {User} from 'quantified-self-lib/lib/users/user';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {EventService} from './app.event.service';
import {map, take} from 'rxjs/operators';
import {AppThemes, UserAppSettingsInterface} from 'quantified-self-lib/lib/users/user.app.settings.interface';
import {
  ChartThemes,
  DataTypeSettings,
  UserChartSettingsInterface, XAxisTypes
} from 'quantified-self-lib/lib/users/user.chart.settings.interface';
import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {UserSettingsInterface} from 'quantified-self-lib/lib/users/user.settings.interface';
import {
  PaceUnits,
  SpeedUnits,
  UserUnitSettingsInterface, VerticalSpeedUnits
} from 'quantified-self-lib/lib/users/user.unit.settings.interface';
import {AngularFireAuth} from '@angular/fire/auth';
import {HttpClient} from '@angular/common/http';
import {environment} from '../../environments/environment';
import {ServiceTokenInterface} from 'quantified-self-lib/lib/service-tokens/service-token.interface';
import * as Raven from 'raven-js';
import {ServiceNames} from 'quantified-self-lib/lib/meta-data/meta-data.interface';


@Injectable()
export class UserService implements OnDestroy {

  protected logger = Log.create('UserService');

  constructor(
    private afs: AngularFirestore,
    private eventService: EventService,
    private afAuth: AngularFireAuth,
    private http: HttpClient,
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
      throw new Error('User has not accepted privacy or data policy');
    }
    const userRef: AngularFirestoreDocument = this.afs.doc(
      `users/${user.uid}`,
    );
    await userRef.set(user.toJSON());
    return Promise.resolve(user);
  }

  public async setServiceAuthToken(user: User, serviceName: string, serviceToken: ServiceTokenInterface) {
    if (serviceName !== 'Suunto App') {
      throw new Error('Service not supported');
    }
    return this.afs.doc(
      `suuntoAppAccessTokens/${user.uid}`,
    ).set(JSON.parse(JSON.stringify(serviceToken)))
  }

  public getServiceAuthToken(user: User, serviceName: string): Observable<ServiceTokenInterface> {
    if (serviceName !== 'Suunto App') {
      throw new Error('Service not supported');
    }
    return this.afs
      .collection('suuntoAppAccessTokens')
      .doc<ServiceTokenInterface>(user.uid).valueChanges();
  }

  public async deauthorizeSuuntoAppService() {
    return await this.http.post(
      environment.functions.deauthorizeSuuntoAppServiceURI, {
        firebaseAuthToken: await this.afAuth.auth.currentUser.getIdToken(true)
      }).toPromise();
  }

  public async updateUserProperties(user: User, propertiesToUpdate: any) {
    return this.afs.collection('users').doc(user.uid).update(propertiesToUpdate);
  }

  public async setUserPrivacy(user: User, privacy: Privacy) {
    return this.updateUserProperties(user, {privacy: privacy});
  }


  public async deleteAllUserData(user: User) {
    const events = await this.eventService.getEventsForUser(user, [], 'startDate', false, 0).pipe(take(1)).toPromise();
    const promises = [];
    events.forEach((event) => {
      promises.push(this.eventService.deleteAllEventData(user, event.getID()));
    });

    const serviceToken = await this.getServiceAuthToken(user, ServiceNames.SuuntoApp);
    if (serviceToken) {
      try {
        await this.deauthorizeSuuntoAppService();
      } catch (e) {
        Raven.captureException(e);
        console.error(`Could not deauthorize Suunto app`)
      }
      try {
        await Promise.all(promises);
        await this.afs.collection('suuntoAppAccessTokens').doc(user.uid).delete();
        await this.afs.collection('users').doc(user.uid).delete();
        return this.afAuth.auth.currentUser.delete();
      } catch (e) {
        Raven.captureException(e);
        throw e;
      }
    }
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
    settings.chartSettings.useAnimations = settings.chartSettings.useAnimations !== false;
    settings.chartSettings.xAxisType = settings.chartSettings.xAxisType || XAxisTypes.Duration;
    settings.unitSettings = settings.unitSettings || <UserUnitSettingsInterface>{};
    settings.unitSettings.speedUnits = settings.unitSettings.speedUnits || [SpeedUnits.MetersPerSecond];
    settings.unitSettings.paceUnits = settings.unitSettings.paceUnits || [PaceUnits.MinutesPerKilometer];
    settings.unitSettings.verticalSpeedUnits = settings.unitSettings.verticalSpeedUnits || [VerticalSpeedUnits.MetersPerSecond];
    return settings;
  }

  ngOnDestroy() {
  }


}
