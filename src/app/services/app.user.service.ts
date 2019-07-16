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
  UserChartSettingsInterface,
  XAxisTypes
} from 'quantified-self-lib/lib/users/user.chart.settings.interface';
import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {UserSettingsInterface} from 'quantified-self-lib/lib/users/user.settings.interface';
import {
  DaysOfTheWeek,
  PaceUnits,
  SpeedUnits, SwimPaceUnits,
  UserUnitSettingsInterface,
  VerticalSpeedUnits
} from 'quantified-self-lib/lib/users/user.unit.settings.interface';
import {AngularFireAuth} from '@angular/fire/auth';
import {HttpClient} from '@angular/common/http';
import {environment} from '../../environments/environment';
import {ServiceTokenInterface} from 'quantified-self-lib/lib/service-tokens/service-token.interface';
import * as Sentry from '@sentry/browser';
import {ServiceNames} from 'quantified-self-lib/lib/meta-data/meta-data.interface';
import {UserServiceMetaInterface} from 'quantified-self-lib/lib/users/user.service.meta.interface';
import {
  DateRanges,
  UserDashboardSettingsInterface
} from 'quantified-self-lib/lib/users/user.dashboard.settings.interface';
import {
  ChartDataValueTypes,
  ChartTypes,
  UserDashboardChartSettingsInterface
} from 'quantified-self-lib/lib/users/user.dashboard.chart.settings.interface';
import {DataDuration} from 'quantified-self-lib/lib/data/data.duration';
import {DataDistance} from 'quantified-self-lib/lib/data/data.distance';
import {DataEnergy} from 'quantified-self-lib/lib/data/data.energy';
import {DataAscent} from 'quantified-self-lib/lib/data/data.ascent';
import {MapThemes, MapTypes, UserMapSettingsInterface} from "quantified-self-lib/lib/users/user.map.settings.interface";
import {LapTypes} from 'quantified-self-lib/lib/laps/lap.types';
import {MapType} from '@angular/compiler';


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
    if (serviceName !== ServiceNames.SuuntoApp) {
      throw new Error('Service not supported');
    }
    return this.afs.collection(`suuntoAppAccessTokens`).doc(user.uid).collection('tokens').doc(serviceToken.userName)
      .set(JSON.parse(JSON.stringify(serviceToken)))
  }

  public getServiceAuthToken(user: User, serviceName: string) {
    if (serviceName !== ServiceNames.SuuntoApp) {
      throw new Error('Service not supported');
    }
    return this.afs
      .collection('suuntoAppAccessTokens')
      .doc<ServiceTokenInterface>(user.uid).collection('tokens').valueChanges();
  }

  private getAllUserMeta(user: User) {
    return this.afs
      .collection('users')
      .doc(user.uid).collection('meta');
  }

  private getAccountPrivileges(user: User) {
    return this.afs
      .collection('userAccountPrivileges')
      .doc(user.uid);
  }

  public getUserMetaForService(user: User, serviceName: string): Observable<UserServiceMetaInterface> {
    return this.getAllUserMeta(user).doc(serviceName).valueChanges().pipe(map((doc) => {
      return <UserServiceMetaInterface>doc;
    }))
  }

  public async importSuuntoAppHistory(startDate: Date, endDate: Date) {
    return this.http.post(
      environment.functions.historyImportURI, {
        firebaseAuthToken: await this.afAuth.auth.currentUser.getIdToken(true),
        startDate: startDate,
        endDate: endDate
      }).toPromise();
  }

  public async deauthorizeSuuntoAppService() {
    return this.http.post(
      environment.functions.deauthorizeSuuntoAppServiceURI, {
        firebaseAuthToken: await this.afAuth.auth.currentUser.getIdToken(true)
      }).toPromise();
  }

  public async updateUserProperties(user: User, propertiesToUpdate: any) {
    return this.afs.collection('users').doc(user.uid).update(propertiesToUpdate);
  }

  public async updateUser(user: User) {
    debugger;
    const a  = user.toJSON();
    debugger;

    return this.afs.collection('users').doc(user.uid).update(user.toJSON());
  }

  public async setUserPrivacy(user: User, privacy: Privacy) {
    return this.updateUserProperties(user, {privacy: privacy});
  }

  public async isBranded(user: User): Promise<boolean> {
    return this.getAccountPrivileges(user).get().pipe(take(1)).pipe(map((doc) => {
      if (!doc.exists) {
        return false;
      }
      return doc.data().isBranded;
    })).toPromise();
  }

  public async deleteAllUserData(user: User) {
    const events = await this.eventService.getEventsAndActivitiesForUserBy(user, [], 'startDate', false, 0).pipe(take(1)).toPromise();
    const promises = [];
    events.forEach((event) => {
      promises.push(this.eventService.deleteAllEventData(user, event.getID()));
    });

    const serviceToken = await this.getServiceAuthToken(user, ServiceNames.SuuntoApp);
    if (serviceToken) {
      try {
        await this.deauthorizeSuuntoAppService();
      } catch (e) {
        Sentry.captureException(e);
        console.error(`Could not deauthorize Suunto app`)
      }
      try {
        await Promise.all(promises);
        await this.afs.collection('suuntoAppAccessTokens').doc(user.uid).delete();
        await this.afs.collection('users').doc(user.uid).delete();
        return this.afAuth.auth.currentUser.delete();
      } catch (e) {
        Sentry.captureException(e);
        throw e;
      }
    }
  }

  public getDefaultChartTheme(): ChartThemes {
    return ChartThemes.Material;
  }

  public getDefaultAppTheme(): AppThemes {
    return AppThemes.Normal;
  }

  public getDefaultMapTheme(): MapThemes {
    return MapThemes.Normal;
  }

  // @todo move other calls to this

  private getDefaultUserChartSettingsDataTypeSettings(): DataTypeSettings {
    return DynamicDataLoader.basicDataTypes.reduce((dataTypeSettings: DataTypeSettings, dataTypeToUse: string) => {
      dataTypeSettings[dataTypeToUse] = {enabled: true};
      return dataTypeSettings
    }, {})
  }

  getDefaultUserDashboardChartSettings(): UserDashboardChartSettingsInterface[] {
    return [{
      name: 'Duration',
      order: 0,
      type: ChartTypes.Pie,
      dataType: DataDuration.type,
      dataValueType: ChartDataValueTypes.Total
    }, {
      name: 'Distance',
      order: 1,
      type: ChartTypes.Pie,
      dataType: DataDistance.type,
      dataValueType: ChartDataValueTypes.Total
    }, {
      name: 'Energy',
      order: 2,
      type: ChartTypes.ColumnsHorizontal,
      dataType: DataEnergy.type,
      dataValueType: ChartDataValueTypes.Total
    }, {
      name: 'Ascent',
      order: 3,
      type: ChartTypes.PyramidsVertical,
      dataType: DataAscent.type,
      dataValueType: ChartDataValueTypes.Maximum
    }]
  }

  private fillMissingAppSettings(user: User): UserSettingsInterface {
    const settings: UserSettingsInterface = user.settings || {};
    // App
    settings.appSettings = settings.appSettings || <UserAppSettingsInterface>{};
    settings.appSettings.theme = settings.appSettings.theme || this.getDefaultAppTheme();
    // Chart
    settings.chartSettings = settings.chartSettings || <UserChartSettingsInterface>{};
    settings.chartSettings.dataTypeSettings = settings.chartSettings.dataTypeSettings || this.getDefaultUserChartSettingsDataTypeSettings();
    settings.chartSettings.theme = settings.chartSettings.theme || this.getDefaultChartTheme();
    settings.chartSettings.useAnimations = settings.chartSettings.useAnimations !== false;
    settings.chartSettings.xAxisType = settings.chartSettings.xAxisType || XAxisTypes.Duration;
    settings.chartSettings.showAllData = settings.chartSettings.showAllData === true;
    settings.chartSettings.dataSmoothingLevel = settings.chartSettings.dataSmoothingLevel || 3;

    // Units
    settings.unitSettings = settings.unitSettings || <UserUnitSettingsInterface>{};
    settings.unitSettings.speedUnits = settings.unitSettings.speedUnits || [SpeedUnits.MetersPerSecond];
    settings.unitSettings.paceUnits = settings.unitSettings.paceUnits || [PaceUnits.MinutesPerKilometer];
    settings.unitSettings.swimPaceUnits = settings.unitSettings.swimPaceUnits || [SwimPaceUnits.MinutesPer100Meter];
    settings.unitSettings.verticalSpeedUnits = settings.unitSettings.verticalSpeedUnits || [VerticalSpeedUnits.MetersPerSecond];
    settings.unitSettings.startOfTheWeek = settings.unitSettings.startOfTheWeek || DaysOfTheWeek.Sunday;
    // Dashboard
    settings.dashboardSettings = settings.dashboardSettings || <UserDashboardSettingsInterface>{};
    settings.dashboardSettings.dateRange = settings.dashboardSettings.dateRange || DateRanges.thisWeek;
    settings.dashboardSettings.startDate = settings.dashboardSettings.startDate || null;
    settings.dashboardSettings.endDate = settings.dashboardSettings.endDate || null;
    settings.dashboardSettings.chartsSettings = settings.dashboardSettings.chartsSettings || this.getDefaultUserDashboardChartSettings();
    settings.dashboardSettings.pinUploadSection = settings.dashboardSettings.pinUploadSection === true;
    settings.dashboardSettings.showSummaries = settings.dashboardSettings.showSummaries !== false;
    // Map
    settings.mapSettings = settings.mapSettings || <UserMapSettingsInterface>{};
    settings.mapSettings.theme = settings.mapSettings.theme || this.getDefaultMapTheme();
    settings.mapSettings.showLaps = settings.mapSettings.showLaps !== false;
    settings.mapSettings.showArrows = settings.mapSettings.showArrows !== false;
    settings.mapSettings.lapTypes = settings.mapSettings.lapTypes || [LapTypes.AutoLap, LapTypes.Distance];
    settings.mapSettings.mapType = settings.mapSettings.mapType || MapTypes.RoadMap;

    // @warning !!!!!! Enums with 0 as start value default to the override
    return settings;
  }

  ngOnDestroy() {
  }


}
