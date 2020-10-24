import { Injectable, OnDestroy } from '@angular/core';
import { Log } from 'ng2-logger/browser';
import { AngularFirestore, AngularFirestoreDocument } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { Privacy } from '@sports-alliance/sports-lib/lib/privacy/privacy.class.interface';
import { AppEventService } from './app.event.service';
import { catchError, map, take } from 'rxjs/operators';
import {
  AppThemes,
  UserAppSettingsInterface
} from '@sports-alliance/sports-lib/lib/users/settings/user.app.settings.interface';
import {
  ChartCursorBehaviours,
  ChartThemes,
  DataTypeSettings,
  UserChartSettingsInterface,
  XAxisTypes
} from '@sports-alliance/sports-lib/lib/users/settings/user.chart.settings.interface';
import { DynamicDataLoader } from '@sports-alliance/sports-lib/lib/data/data.store';
import { UserSettingsInterface } from '@sports-alliance/sports-lib/lib/users/settings/user.settings.interface';
import {
  DaysOfTheWeek,
  GradeAdjustedPaceUnits,
  GradeAdjustedSpeedUnits,
  PaceUnits,
  PaceUnitsToGradeAdjustedPaceUnits,
  SpeedUnits,
  SpeedUnitsToGradeAdjustedSpeedUnits,
  SwimPaceUnits,
  UserUnitSettingsInterface,
  VerticalSpeedUnits
} from '@sports-alliance/sports-lib/lib/users/settings/user.unit.settings.interface';
import { AngularFireAuth } from '@angular/fire/auth';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';
import * as Sentry from '@sentry/browser';
import { UserServiceMetaInterface } from '@sports-alliance/sports-lib/lib/users/user.service.meta.interface';
import {
  DateRanges,
  TableSettings,
  UserDashboardSettingsInterface
} from '@sports-alliance/sports-lib/lib/users/settings/dashboard/user.dashboard.settings.interface';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TileChartSettingsInterface,
  TileMapSettingsInterface,
  TileSettingsInterface,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';
import { DataDuration } from '@sports-alliance/sports-lib/lib/data/data.duration';
import { DataDistance } from '@sports-alliance/sports-lib/lib/data/data.distance';
import { DataAscent } from '@sports-alliance/sports-lib/lib/data/data.ascent';
import {
  MapThemes,
  MapTypes,
  UserMapSettingsInterface
} from '@sports-alliance/sports-lib/lib/users/settings/user.map.settings.interface';
import { LapTypes } from '@sports-alliance/sports-lib/lib/laps/lap.types';
import { isNumber } from '@sports-alliance/sports-lib/lib/events/utilities/helpers';
import { UserExportToCsvSettingsInterface } from '@sports-alliance/sports-lib/lib/users/user.export-to-csv.settings.interface';
import { DataAltitude } from '@sports-alliance/sports-lib/lib/data/data.altitude';
import { DataHeartRate } from '@sports-alliance/sports-lib/lib/data/data.heart-rate';
import { ActivityTypes } from '@sports-alliance/sports-lib/lib/activities/activity.types';
import { UserSummariesSettingsInterface } from '@sports-alliance/sports-lib/lib/users/settings/user.summaries.settings.interface';
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib/lib/service-tokens/oauth2-service-token.interface';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';
import { AppWindowService } from './app.window.service';
import { UserMyTracksSettingsInterface } from '@sports-alliance/sports-lib/lib/users/settings/user.my-tracks.settings.interface';
import { DataDescription } from '@sports-alliance/sports-lib/lib/data/data.description';
import { DataActivityTypes } from '@sports-alliance/sports-lib/lib/data/data.activity-types';
import { DataDescent } from '@sports-alliance/sports-lib/lib/data/data.descent';
import { DataEnergy } from '@sports-alliance/sports-lib/lib/data/data.energy';
import { DataHeartRateAvg } from '@sports-alliance/sports-lib/lib/data/data.heart-rate-avg';
import { DataSpeedAvg } from '@sports-alliance/sports-lib/lib/data/data.speed-avg';
import { DataPowerAvg } from '@sports-alliance/sports-lib/lib/data/data.power-avg';
import { DataVO2Max } from '@sports-alliance/sports-lib/lib/data/data.vo2-max';
import { DataDeviceNames } from '@sports-alliance/sports-lib/lib/data/data.device-names';
import { DataPowerMax } from '@sports-alliance/sports-lib/lib/data/data.power-max';
import { DataPeakTrainingEffect } from '@sports-alliance/sports-lib/lib/data/data.peak-training-effect';
import { DataEPOC } from '@sports-alliance/sports-lib/lib/data/data.epoc';
import { DataPeakEPOC } from '@sports-alliance/sports-lib/lib/data/data.peak-epoc';
import { DataTotalTrainingEffect } from '@sports-alliance/sports-lib/lib/data/data.total-training-effect';
import { DataRecoveryTime } from '@sports-alliance/sports-lib/lib/data/data.recovery-time';


/**
 * @todo  break up to partners (Services) and user
 */
@Injectable({
  providedIn: 'root',
})
export class AppUserService implements OnDestroy {

  protected logger = Log.create('UserService');

  constructor(
    private afs: AngularFirestore,
    private eventService: AppEventService,
    private afAuth: AngularFireAuth,
    private http: HttpClient,
    private windowService: AppWindowService,
  ) {

  }

  static getDefaultChartTheme(): ChartThemes {
    return ChartThemes.Material;
  }

  static getDefaultAppTheme(): AppThemes {
    return AppThemes.Normal;
  }

  static getDefaultMapTheme(): MapThemes {
    return MapThemes.Normal;
  }

  static getDefaultChartCursorBehaviour(): ChartCursorBehaviours {
    return ChartCursorBehaviours.ZoomX;
  }

  static getDefaultMapStrokeWidth(): number {
    return 4;
  }

  static getDefaultChartDataTypesToShowOnLoad(): string[] {
    return [
      DataAltitude.type,
      DataHeartRate.type,
    ]
  }

  static getDefaultUserChartSettingsDataTypeSettings(): DataTypeSettings {
    return DynamicDataLoader.basicDataTypes.reduce((dataTypeSettings: DataTypeSettings, dataTypeToUse: string) => {
      dataTypeSettings[dataTypeToUse] = {enabled: true};
      return dataTypeSettings
    }, {})
  }

  static getDefaultUserDashboardChartTile(): TileChartSettingsInterface {
    return {
      name: 'Distance',
      order: 0,
      type: TileTypes.Chart,
      chartType: ChartTypes.ColumnsHorizontal,
      dataType: DataDistance.type,
      dataTimeInterval: TimeIntervals.Auto,
      dataCategoryType: ChartDataCategoryTypes.ActivityType,
      dataValueType: ChartDataValueTypes.Total,
      size: {columns: 1, rows: 1},
    };
  }

  static getDefaultUserDashboardMapTile(): TileMapSettingsInterface {
    return {
      name: 'Clustered HeatMap',
      order: 0,
      type: TileTypes.Map,
      mapType: MapTypes.Terrain,
      mapTheme: MapThemes.MidnightCommander,
      showHeatMap: true,
      clusterMarkers: true,
      size: {columns: 1, rows: 1},
    };
  }

  static getDefaultUserDashboardTiles(): TileSettingsInterface[] {
    return [<TileMapSettingsInterface>{
      name: 'Clustered HeatMap',
      order: 0,
      type: TileTypes.Map,
      mapType: MapTypes.RoadMap,
      mapTheme: MapThemes.MidnightCommander,
      showHeatMap: true,
      clusterMarkers: true,
      size: {columns: 1, rows: 1},
    }, <TileChartSettingsInterface>{
      name: 'Duration',
      order: 1,
      type: TileTypes.Chart,
      chartType: ChartTypes.Pie,
      dataCategoryType: ChartDataCategoryTypes.ActivityType,
      dataType: DataDuration.type,
      dataTimeInterval: TimeIntervals.Auto,
      dataValueType: ChartDataValueTypes.Total,
      size: {columns: 1, rows: 1},
    }, <TileChartSettingsInterface>{
      name: 'Distance',
      order: 2,
      type: TileTypes.Chart,
      chartType: ChartTypes.ColumnsHorizontal,
      dataType: DataDistance.type,
      dataTimeInterval: TimeIntervals.Auto,
      dataCategoryType: ChartDataCategoryTypes.ActivityType,
      dataValueType: ChartDataValueTypes.Total,
      size: {columns: 1, rows: 1},
    }, <TileChartSettingsInterface>{
      name: 'Ascent',
      order: 3,
      type: TileTypes.Chart,
      chartType: ChartTypes.PyramidsVertical,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataType: DataAscent.type,
      dataTimeInterval: TimeIntervals.Auto,
      dataValueType: ChartDataValueTypes.Total,
      size: {columns: 1, rows: 1},
    }]
  }

  static getDefaultMapLapTypes(): LapTypes[] {
    return [LapTypes.AutoLap, LapTypes.Distance, LapTypes.Manual];
  }

  static getDefaultChartLapTypes(): LapTypes[] {
    return [LapTypes.AutoLap, LapTypes.Distance, LapTypes.Manual];
  }

  static getDefaultDownSamplingLevel(): number {
    return 4;
  }

  static getDefaultGainAndLossThreshold(): number {
    return 1;
  }

  static getDefaultExtraMaxForPower(): number {
    return 0;
  }

  static getDefaultExtraMaxForPace(): number {
    return -0.25;
  }

  static getDefaultMapType(): MapTypes {
    return MapTypes.RoadMap;
  }

  static getDefaultDateRange(): DateRanges {
    return DateRanges.all;
  }

  static getDefaultXAxisType(): XAxisTypes {
    return XAxisTypes.Time;
  }

  static getDefaultSpeedUnits(): SpeedUnits[] {
    return [SpeedUnits.KilometersPerHour];
  }

  static getDefaultGradeAdjustedSpeedUnits(): GradeAdjustedSpeedUnits[] {
    return this.getGradeAdjustedSpeedUnitsFromSpeedUnits(this.getDefaultSpeedUnits());
  }

  static getGradeAdjustedSpeedUnitsFromSpeedUnits(speedUnits: SpeedUnits[]): GradeAdjustedSpeedUnits[] {
    return speedUnits.map(speedUnit => GradeAdjustedSpeedUnits[SpeedUnitsToGradeAdjustedSpeedUnits[speedUnit]]);
  }

  static getDefaultPaceUnits(): PaceUnits[] {
    return [PaceUnits.MinutesPerKilometer];
  }

  static getDefaultGradeAdjustedPaceUnits(): GradeAdjustedPaceUnits[] {
    return this.getGradeAdjustedPaceUnitsFromPaceUnits(this.getDefaultPaceUnits());
  }

  static getGradeAdjustedPaceUnitsFromPaceUnits(paceUnits: PaceUnits[]): GradeAdjustedPaceUnits[] {
    return paceUnits.map(paceUnit => GradeAdjustedPaceUnits[PaceUnitsToGradeAdjustedPaceUnits[paceUnit]]);
  }

  static getDefaultSwimPaceUnits(): SwimPaceUnits[] {
    return [SwimPaceUnits.MinutesPer100Meter];
  }

  static getDefaultVerticalSpeedUnits(): VerticalSpeedUnits[] {
    return [VerticalSpeedUnits.MetersPerSecond];
  }

  static getDefaultUserUnitSettings(): UserUnitSettingsInterface {
    const unitSettings = <UserUnitSettingsInterface>{};
    unitSettings.speedUnits = AppUserService.getDefaultSpeedUnits();
    unitSettings.gradeAdjustedSpeedUnits = AppUserService.getDefaultGradeAdjustedSpeedUnits();
    unitSettings.paceUnits = AppUserService.getDefaultPaceUnits();
    unitSettings.gradeAdjustedPaceUnits = AppUserService.getDefaultGradeAdjustedPaceUnits();
    unitSettings.swimPaceUnits = AppUserService.getDefaultSwimPaceUnits();
    unitSettings.verticalSpeedUnits = AppUserService.getDefaultVerticalSpeedUnits();
    unitSettings.startOfTheWeek = AppUserService.getDefaultStartOfTheWeek();
    return unitSettings;
  }

  static getDefaultStartOfTheWeek(): DaysOfTheWeek {
    return DaysOfTheWeek.Monday;
  }

  static getDefaultChartStrokeWidth(): number {
    return 1.15;
  }

  static getDefaultChartStrokeOpacity(): number {
    return 1;
  }

  static getDefaultChartFillOpacity(): number {
    return 0.35;
  }

  static getDefaultTableSettings(): TableSettings {
    return {
      eventsPerPage: 10,
      active: 'startDate',
      direction: 'desc',
      selectedColumns: this.getDefaultSelectedTableColumns()
    }
  }

  static getDefaultSelectedTableColumns(): string[] {
    return [
      'Start Date',
      DataDescription.type,
      DataActivityTypes.type,
      DataDuration.type,
      DataDistance.type,
      DataAscent.type,
      DataDescent.type,
      DataEnergy.type,
      DataHeartRateAvg.type,
      DataSpeedAvg.type,
      DataPowerAvg.type,
      DataPowerMax.type,
      DataVO2Max.type,
      DataTotalTrainingEffect.type,
      DataRecoveryTime.type,
      DataPeakEPOC.type,
      DataDeviceNames.type,
    ]
  }

  static getDefaultMyTracksDateRange(): DateRanges {
    return DateRanges.lastThirtyDays
  }

  static getDefaultActivityTypesToRemoveAscentFromSummaries(): ActivityTypes[] {
    return [ActivityTypes.AlpineSki, ActivityTypes.Snowboard]
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

  public getServiceToken(user: User, serviceName: ServiceNames) {
    switch (serviceName) {
      default:
        throw new Error(`Not implemented for service ${serviceName}`);
      case ServiceNames.COROSAPI:
      case ServiceNames.SuuntoApp:
        return this.getServiceTokens(user, serviceName);
      case ServiceNames.GarminHealthAPI:
        return this.getGarminHealthAPITokens(user);
    }
  }

  public getUserMetaForService(user: User, serviceName: string): Observable<UserServiceMetaInterface> {
    return this.getAllUserMeta(user).doc(serviceName).valueChanges().pipe(map((doc) => {
      return <UserServiceMetaInterface>doc;
    }))
  }

  public shouldShowPromo(user: User) {
    // Intentionally just check if only set for now
    if (!user || user.lastSeenPromo) {
      return false;
    }
    return (+user.lastSignInDate - +user.creationDate) > 60 * 60 * 24 * 30 * 1000; // Bigger than 1 months
  }

  public async setLastSeenPromoToNow(user: User) {
    return this.updateUserProperties(user, {lastSeenPromo: (new Date().getTime())})
  }

  async importServiceHistoryForCurrentUser(serviceName: ServiceNames, startDate: Date, endDate: Date) {
    const idToken = await (await this.afAuth.currentUser).getIdToken(true);
    const serviceNamesToFunctionsURI = {
      [ServiceNames.SuuntoApp]: environment.functions.suuntoAPIHistoryImportURI,
      [ServiceNames.GarminHealthAPI]: environment.functions.backfillHealthAPIActivities,
      [ServiceNames.COROSAPI]: environment.functions.COROSAPIHistoryImportURI,
    }
    return this.http.post(
      serviceNamesToFunctionsURI[serviceName], {
        startDate: startDate,
        endDate: endDate
      },
      {
        headers:
          new HttpHeaders({
            'Authorization': `Bearer ${idToken}`
          })
      }).toPromise();
  }

  public async deauthorizeService(serviceName: ServiceNames) {
    const idToken = await (await this.afAuth.currentUser).getIdToken(true);
    const serviceNamesToFunctionsURI = {
      [ServiceNames.SuuntoApp]: environment.functions.deauthorizeSuuntoApp,
      [ServiceNames.GarminHealthAPI]: environment.functions.deauthorizeGarminHealthAPI,
      [ServiceNames.COROSAPI]: environment.functions.deauthorizeCOROSAPI,
    }
    return this.http.post(
      serviceNamesToFunctionsURI[serviceName],
      {},
      {
        headers:
          new HttpHeaders({
            'Authorization': `Bearer ${idToken}`
          })
      }).toPromise();
  }

  public async getCurrentUserServiceTokenAndRedirectURI(serviceName: ServiceNames): Promise<{ redirect_uri: string } | { redirect_uri: string, state: string, oauthToken: string }> {
    const serviceNamesToFunctionsURI = {
      [ServiceNames.SuuntoApp]: environment.functions.getSuuntoAPIAuthRequestTokenRedirectURI,
      [ServiceNames.GarminHealthAPI]: environment.functions.getGarminHealthAPIAuthRequestTokenRedirectURI,
      [ServiceNames.COROSAPI]: environment.functions.getCOROSAPIAuthRequestTokenRedirectURI
    }
    const idToken = await (await this.afAuth.currentUser).getIdToken(true);
    return <Promise<{ redirect_uri: string }>>this.http.post(
      serviceNamesToFunctionsURI[serviceName], {
        redirectUri: encodeURI(`${this.windowService.currentDomain}/services?serviceName=${serviceName}&connect=1`)
      },
      {
        headers:
          new HttpHeaders({
            'Authorization': `Bearer ${idToken}`
          })
      }).toPromise();
  }

  public async requestAndSetCurrentUserGarminAccessToken(state: string, oauthVerifier: string) {
    const idToken = await (await this.afAuth.currentUser).getIdToken(true);
    return this.http.post(
      environment.functions.requestAndSetGarminHealthAPIAccessToken, {
        state: state,
        oauthVerifier: oauthVerifier
      },
      {
        headers:
          new HttpHeaders({
            'Authorization': `Bearer ${idToken}`
          })
      }).toPromise();
  }

  public async requestAndSetCurrentUserSuuntoAppAccessToken(state: string, code: string) {
    const idToken = await (await this.afAuth.currentUser).getIdToken(true);
    return this.http.post(
      environment.functions.requestAndSetSuuntoAPIAccessToken, {
        state: state,
        code: code,
        redirectUri: encodeURI(`${this.windowService.currentDomain}/services?serviceName=${ServiceNames.SuuntoApp}&connect=1`)
      },
      {
        headers:
          new HttpHeaders({
            'Authorization': `Bearer ${idToken}`
          })
      }).toPromise();
  }

  public async requestAndSetCurrentUserCOROSAPIAccessToken(state: string, code: string) {
    const idToken = await (await this.afAuth.currentUser).getIdToken(true);
    return this.http.post(
      environment.functions.requestAndSetCOROSAPIAccessToken, {
        state: state,
        code: code,
        redirectUri: encodeURI(`${this.windowService.currentDomain}/services?serviceName=${ServiceNames.COROSAPI}&connect=1`)
      },
      {
        headers:
          new HttpHeaders({
            'Authorization': `Bearer ${idToken}`
          })
      }).toPromise();
  }

  public async updateUserProperties(user: User, propertiesToUpdate: any) {
    return this.afs.collection('users').doc(user.uid).update(propertiesToUpdate);
  }

  public async updateUser(user: User) {
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
    const serviceTokens = [
      {[ServiceNames.SuuntoApp]: await this.getServiceTokens(user, ServiceNames.SuuntoApp).pipe(take(1)).toPromise()},
      {[ServiceNames.COROSAPI]: await this.getServiceTokens(user, ServiceNames.COROSAPI).pipe(take(1)).toPromise()},
      {[ServiceNames.GarminHealthAPI]: await this.getGarminHealthAPITokens(user).pipe(take(1)).toPromise()}
    ].filter((serviceToken) => serviceToken[Object.keys(serviceToken)[0]])
    for (const serviceToken of serviceTokens) {
      try {
        await this.deauthorizeService(<ServiceNames>Object.keys(serviceToken)[0]);
      } catch (e) {
        Sentry.captureException(e);
        console.error(`Could not deauthorize ${ServiceNames.SuuntoApp}`)
      }
    }

    try {
      return (await this.afAuth.currentUser).delete();
    } catch (e) {
      Sentry.captureException(e);
      throw e;
    }
  }

  public getUserChartDataTypesToUse(user: User): string[] {
    return Object.keys(user.settings.chartSettings.dataTypeSettings).reduce((dataTypesToUse, dataTypeSettingsKey) => {
      if (user.settings.chartSettings.dataTypeSettings[dataTypeSettingsKey].enabled === true) {
        dataTypesToUse.push(dataTypeSettingsKey);
      }
      return dataTypesToUse;
    }, [])
  }

  ngOnDestroy() {
  }

  private getServiceTokens(user: User, serviceName: ServiceNames) {
    const serviceNamesToCollectionName = {
      [ServiceNames.SuuntoApp]: 'suuntoAppAccessTokens',
      [ServiceNames.COROSAPI]: 'COROSAPIAccessTokens'
    }
    return this.afs
      .collection(serviceNamesToCollectionName[serviceName])
      .doc<Auth2ServiceTokenInterface>(user.uid)
      .collection('tokens')
      .valueChanges()
      .pipe(catchError(error => {
        return [];
      }));
  }

  private getGarminHealthAPITokens(user: User) {
    return this.afs
      .collection('garminHealthAPITokens')
      .doc(user.uid).valueChanges().pipe(map(doc => [doc]))// We create an array to be consistent with the other provides that support more than one token
      .pipe(catchError(error => {
        return [];
      }));
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

  private fillMissingAppSettings(user: User): UserSettingsInterface {
    const settings: UserSettingsInterface = user.settings || {};
    // App
    settings.appSettings = settings.appSettings || <UserAppSettingsInterface>{};
    settings.appSettings.theme = settings.appSettings.theme || AppUserService.getDefaultAppTheme();
    // Chart
    settings.chartSettings = settings.chartSettings || <UserChartSettingsInterface>{};
    settings.chartSettings.dataTypeSettings = settings.chartSettings.dataTypeSettings || AppUserService.getDefaultUserChartSettingsDataTypeSettings();
    settings.chartSettings.theme = settings.chartSettings.theme || AppUserService.getDefaultChartTheme();
    settings.chartSettings.useAnimations = settings.chartSettings.useAnimations === true;
    settings.chartSettings.xAxisType = XAxisTypes[settings.chartSettings.xAxisType] || AppUserService.getDefaultXAxisType();
    settings.chartSettings.showAllData = settings.chartSettings.showAllData === true;
    settings.chartSettings.downSamplingLevel = settings.chartSettings.downSamplingLevel || AppUserService.getDefaultDownSamplingLevel();
    settings.chartSettings.chartCursorBehaviour = settings.chartSettings.chartCursorBehaviour || AppUserService.getDefaultChartCursorBehaviour();
    settings.chartSettings.strokeWidth = settings.chartSettings.strokeWidth || AppUserService.getDefaultChartStrokeWidth();
    settings.chartSettings.strokeOpacity = isNumber(settings.chartSettings.strokeOpacity) ? settings.chartSettings.strokeOpacity : AppUserService.getDefaultChartStrokeOpacity();
    settings.chartSettings.fillOpacity = isNumber(settings.chartSettings.fillOpacity) ? settings.chartSettings.fillOpacity : AppUserService.getDefaultChartFillOpacity();
    settings.chartSettings.extraMaxForPower = isNumber(settings.chartSettings.extraMaxForPower) ? settings.chartSettings.extraMaxForPower : AppUserService.getDefaultExtraMaxForPower();
    settings.chartSettings.extraMaxForPace = isNumber(settings.chartSettings.extraMaxForPace) ? settings.chartSettings.extraMaxForPace : AppUserService.getDefaultExtraMaxForPace();
    settings.chartSettings.lapTypes = settings.chartSettings.lapTypes || AppUserService.getDefaultChartLapTypes();
    settings.chartSettings.showLaps = settings.chartSettings.showLaps !== false;
    settings.chartSettings.showGrid = settings.chartSettings.showGrid !== false;
    settings.chartSettings.stackYAxes = settings.chartSettings.stackYAxes !== false;
    settings.chartSettings.disableGrouping = settings.chartSettings.disableGrouping === true;
    settings.chartSettings.hideAllSeriesOnInit = settings.chartSettings.hideAllSeriesOnInit === true;
    settings.chartSettings.gainAndLossThreshold = settings.chartSettings.gainAndLossThreshold || AppUserService.getDefaultGainAndLossThreshold();
    // Units
    settings.unitSettings = settings.unitSettings || <UserUnitSettingsInterface>{};
    settings.unitSettings.speedUnits = settings.unitSettings.speedUnits || AppUserService.getDefaultSpeedUnits();
    settings.unitSettings.paceUnits = settings.unitSettings.paceUnits || AppUserService.getDefaultPaceUnits();
    settings.unitSettings.gradeAdjustedSpeedUnits = settings.unitSettings.gradeAdjustedSpeedUnits || AppUserService.getGradeAdjustedSpeedUnitsFromSpeedUnits(settings.unitSettings.speedUnits);
    settings.unitSettings.gradeAdjustedPaceUnits = settings.unitSettings.gradeAdjustedPaceUnits || AppUserService.getGradeAdjustedPaceUnitsFromPaceUnits(settings.unitSettings.paceUnits);
    settings.unitSettings.swimPaceUnits = settings.unitSettings.swimPaceUnits || AppUserService.getDefaultSwimPaceUnits();
    settings.unitSettings.verticalSpeedUnits = settings.unitSettings.verticalSpeedUnits || AppUserService.getDefaultVerticalSpeedUnits()
    settings.unitSettings.startOfTheWeek = isNumber(settings.unitSettings.startOfTheWeek) ? settings.unitSettings.startOfTheWeek : AppUserService.getDefaultStartOfTheWeek();
    // Dashboard
    settings.dashboardSettings = settings.dashboardSettings || <UserDashboardSettingsInterface>{};
    settings.dashboardSettings.dateRange = isNumber(settings.dashboardSettings.dateRange) ? settings.dashboardSettings.dateRange : AppUserService.getDefaultDateRange();
    settings.dashboardSettings.startDate = settings.dashboardSettings.startDate || null;
    settings.dashboardSettings.endDate = settings.dashboardSettings.endDate || null;
    settings.dashboardSettings.activityTypes = settings.dashboardSettings.activityTypes || [];
    settings.dashboardSettings.tiles = settings.dashboardSettings.tiles || AppUserService.getDefaultUserDashboardTiles();
    // Patch missing defaults
    settings.dashboardSettings.tableSettings = settings.dashboardSettings.tableSettings || AppUserService.getDefaultTableSettings();
    settings.dashboardSettings.tableSettings.selectedColumns = settings.dashboardSettings.tableSettings.selectedColumns || AppUserService.getDefaultSelectedTableColumns()

    // Summaries
    settings.summariesSettings = settings.summariesSettings || <UserSummariesSettingsInterface>{};
    settings.summariesSettings.removeAscentForEventTypes = settings.summariesSettings.removeAscentForEventTypes || AppUserService.getDefaultActivityTypesToRemoveAscentFromSummaries();
    // Map
    settings.mapSettings = settings.mapSettings || <UserMapSettingsInterface>{};
    settings.mapSettings.theme = settings.mapSettings.theme || AppUserService.getDefaultMapTheme();
    settings.mapSettings.showLaps = settings.mapSettings.showLaps !== false;
    settings.mapSettings.showPoints = settings.mapSettings.showPoints === true;
    settings.mapSettings.showArrows = settings.mapSettings.showArrows !== false;
    settings.mapSettings.lapTypes = settings.mapSettings.lapTypes || AppUserService.getDefaultMapLapTypes();
    settings.mapSettings.mapType = settings.mapSettings.mapType || AppUserService.getDefaultMapType();
    settings.mapSettings.strokeWidth = settings.mapSettings.strokeWidth || AppUserService.getDefaultMapStrokeWidth();
    // MyTracks
    settings.myTracksSettings = settings.myTracksSettings || <UserMyTracksSettingsInterface>{};
    settings.myTracksSettings.dateRange = isNumber(settings.myTracksSettings.dateRange)
      ? settings.myTracksSettings.dateRange
      : AppUserService.getDefaultMyTracksDateRange();

    // Export to CSV
    settings.exportToCSVSettings = settings.exportToCSVSettings || <UserExportToCsvSettingsInterface>{};
    settings.exportToCSVSettings.startDate = settings.exportToCSVSettings.startDate !== false;
    settings.exportToCSVSettings.name = settings.exportToCSVSettings.name !== false;
    settings.exportToCSVSettings.description = settings.exportToCSVSettings.description !== false;
    settings.exportToCSVSettings.activityTypes = settings.exportToCSVSettings.activityTypes !== false;
    settings.exportToCSVSettings.distance = settings.exportToCSVSettings.distance !== false;
    settings.exportToCSVSettings.duration = settings.exportToCSVSettings.duration !== false;
    settings.exportToCSVSettings.ascent = settings.exportToCSVSettings.ascent !== false;
    settings.exportToCSVSettings.descent = settings.exportToCSVSettings.descent !== false;
    settings.exportToCSVSettings.calories = settings.exportToCSVSettings.calories !== false;
    settings.exportToCSVSettings.feeling = settings.exportToCSVSettings.feeling !== false;
    settings.exportToCSVSettings.rpe = settings.exportToCSVSettings.rpe !== false;
    settings.exportToCSVSettings.averageSpeed = settings.exportToCSVSettings.averageSpeed !== false;
    settings.exportToCSVSettings.averagePace = settings.exportToCSVSettings.averagePace !== false;
    settings.exportToCSVSettings.averageSwimPace = settings.exportToCSVSettings.averageSwimPace !== false;
    settings.exportToCSVSettings.averageGradeAdjustedPace = settings.exportToCSVSettings.averageGradeAdjustedPace !== false;
    settings.exportToCSVSettings.averageHeartRate = settings.exportToCSVSettings.averageHeartRate !== false;
    settings.exportToCSVSettings.maximumHeartRate = settings.exportToCSVSettings.maximumHeartRate !== false;
    settings.exportToCSVSettings.averagePower = settings.exportToCSVSettings.averagePower !== false;
    settings.exportToCSVSettings.maximumPower = settings.exportToCSVSettings.maximumPower !== false;
    settings.exportToCSVSettings.vO2Max = settings.exportToCSVSettings.vO2Max !== false;
    settings.exportToCSVSettings.includeLink = settings.exportToCSVSettings.includeLink !== false;

    // @warning !!!!!! Enums with 0 as start value default to the override
    return settings;
  }
}
