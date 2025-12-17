import { inject, Injectable, OnDestroy } from '@angular/core';
import { Observable, from, firstValueFrom } from 'rxjs';
import { User } from '@sports-alliance/sports-lib';
import { Privacy } from '@sports-alliance/sports-lib';
import { AppEventService } from './app.event.service';
import { catchError, map, take } from 'rxjs/operators';
import {
  AppThemes,
  UserAppSettingsInterface
} from '@sports-alliance/sports-lib';
import {
  ChartCursorBehaviours,
  ChartThemes,
  DataTypeSettings,
  UserChartSettingsInterface,
  XAxisTypes
} from '@sports-alliance/sports-lib';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import { UserSettingsInterface } from '@sports-alliance/sports-lib';
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
} from '@sports-alliance/sports-lib';
import { Auth, deleteUser, authState } from '@angular/fire/auth';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';
import * as Sentry from '@sentry/browser';
import { UserServiceMetaInterface } from '@sports-alliance/sports-lib';
import {
  DateRanges,
  TableSettings,
  UserDashboardSettingsInterface
} from '@sports-alliance/sports-lib';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TileChartSettingsInterface,
  TileMapSettingsInterface,
  TileSettingsInterface,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { DataDuration } from '@sports-alliance/sports-lib';
import { DataDistance } from '@sports-alliance/sports-lib';
import { DataAscent } from '@sports-alliance/sports-lib';
import {
  MapThemes,
  MapTypes,
  UserMapSettingsInterface
} from '@sports-alliance/sports-lib';
import { LapTypes } from '@sports-alliance/sports-lib';
import { isNumber } from '@sports-alliance/sports-lib';
import { UserExportToCsvSettingsInterface } from '@sports-alliance/sports-lib';
import { DataAltitude } from '@sports-alliance/sports-lib';
import { DataHeartRate } from '@sports-alliance/sports-lib';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { UserSummariesSettingsInterface } from '@sports-alliance/sports-lib';
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { AppWindowService } from './app.window.service';
import { UserMyTracksSettingsInterface } from '@sports-alliance/sports-lib';
import { DataDescription } from '@sports-alliance/sports-lib';
import { DataActivityTypes } from '@sports-alliance/sports-lib';
import { DataDescent } from '@sports-alliance/sports-lib';
import { DataEnergy } from '@sports-alliance/sports-lib';
import { DataHeartRateAvg } from '@sports-alliance/sports-lib';
import { DataSpeedAvg } from '@sports-alliance/sports-lib';
import { DataPowerAvg } from '@sports-alliance/sports-lib';
import { DataVO2Max } from '@sports-alliance/sports-lib';
import { DataDeviceNames } from '@sports-alliance/sports-lib';
import { DataPowerMax } from '@sports-alliance/sports-lib';
import { DataPeakTrainingEffect } from '@sports-alliance/sports-lib';
import { DataEPOC } from '@sports-alliance/sports-lib';
import { DataPeakEPOC } from '@sports-alliance/sports-lib';
import { DataAerobicTrainingEffect } from '@sports-alliance/sports-lib';
import { DataRecoveryTime } from '@sports-alliance/sports-lib';
import { Firestore, doc, docData, collection, collectionData, setDoc, updateDoc, getDoc } from '@angular/fire/firestore';


/**
 * @todo  break up to partners (Services) and user
 */
@Injectable({
  providedIn: 'root',
})
export class AppUserService implements OnDestroy {

  private firestore = inject(Firestore);
  private auth = inject(Auth);

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
      dataTypeSettings[dataTypeToUse] = { enabled: true };
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
      size: { columns: 1, rows: 1 },
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
      size: { columns: 1, rows: 1 },
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
      size: { columns: 1, rows: 1 },
    }, <TileChartSettingsInterface>{
      name: 'Duration',
      order: 1,
      type: TileTypes.Chart,
      chartType: ChartTypes.Pie,
      dataCategoryType: ChartDataCategoryTypes.ActivityType,
      dataType: DataDuration.type,
      dataTimeInterval: TimeIntervals.Auto,
      dataValueType: ChartDataValueTypes.Total,
      size: { columns: 1, rows: 1 },
    }, <TileChartSettingsInterface>{
      name: 'Distance',
      order: 2,
      type: TileTypes.Chart,
      chartType: ChartTypes.ColumnsHorizontal,
      dataType: DataDistance.type,
      dataTimeInterval: TimeIntervals.Auto,
      dataCategoryType: ChartDataCategoryTypes.ActivityType,
      dataValueType: ChartDataValueTypes.Total,
      size: { columns: 1, rows: 1 },
    }, <TileChartSettingsInterface>{
      name: 'Ascent',
      order: 3,
      type: TileTypes.Chart,
      chartType: ChartTypes.PyramidsVertical,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataType: DataAscent.type,
      dataTimeInterval: TimeIntervals.Auto,
      dataValueType: ChartDataValueTypes.Total,
      size: { columns: 1, rows: 1 },
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
      // DataPowerMax.type,
      DataVO2Max.type,
      DataAerobicTrainingEffect.type,
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

  constructor(
    private eventService: AppEventService,
    private http: HttpClient,
    private windowService: AppWindowService,
  ) {

  }

  public getUserByID(userID: string): Observable<User> {
    const userDoc = doc(this.firestore, 'users', userID);
    return docData(userDoc).pipe(map((user: User) => {
      if (!user) {
        return null;
      }
      user.settings = this.fillMissingAppSettings(user);
      return user;
    }));
  }

  public async createOrUpdateUser(user: User) {
    if (!user.acceptedPrivacyPolicy || !user.acceptedDataPolicy) {
      throw new Error('User has not accepted privacy or data policy');
    }
    const userRef = doc(this.firestore, `users/${user.uid}`);
    await setDoc(userRef, user.toJSON());
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
    const metaDoc = doc(this.firestore, 'users', user.uid, 'meta', serviceName);
    return docData(metaDoc).pipe(map((d) => {
      return <UserServiceMetaInterface>d;
    }));
  }

  public shouldShowPromo(user: User) {
    // Intentionally just check if only set for now
    if (!user || user.lastSeenPromo) {
      return false;
    }
    return (+user.lastSignInDate - +user.creationDate) > 60 * 60 * 24 * 30 * 1000; // Bigger than 1 months
  }

  public async setLastSeenPromoToNow(user: User) {
    return this.updateUserProperties(user, { lastSeenPromo: (new Date().getTime()) })
  }

  async importServiceHistoryForCurrentUser(serviceName: ServiceNames, startDate: Date, endDate: Date) {
    const idToken = await this.auth.currentUser?.getIdToken(true);
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
    const idToken = await this.auth.currentUser?.getIdToken(true);
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
    const idToken = await this.auth.currentUser?.getIdToken(true);
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
    const idToken = await this.auth.currentUser?.getIdToken(true);
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
    const idToken = await this.auth.currentUser?.getIdToken(true);
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
    const idToken = await this.auth.currentUser?.getIdToken(true);
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
    return updateDoc(doc(this.firestore, 'users', user.uid), propertiesToUpdate);
  }

  public async updateUser(user: User) {
    return updateDoc(doc(this.firestore, 'users', user.uid), user.toJSON());
  }

  public async setUserPrivacy(user: User, privacy: Privacy) {
    return this.updateUserProperties(user, { privacy: privacy });
  }

  public async isBranded(user: User): Promise<boolean> {
    const privDoc = doc(this.firestore, 'userAccountPrivileges', user.uid);
    return firstValueFrom(from(getDoc(privDoc)).pipe(map((doc) => {
      if (!doc.exists()) {
        return false;
      }
      return doc.data()['isBranded'];
    })));
  }

  public async getSubscriptionRole(): Promise<string | null> {
    const user = await firstValueFrom(authState(this.auth).pipe(take(1)));
    if (!user) {
      console.warn('AppUserService: getSubscriptionRole - No current user');
      return null;
    }
    try {
      // Force refresh to ensure we have latest claims
      const tokenResult = await user.getIdTokenResult(true);
      const role = (tokenResult.claims['stripeRole'] as string) || null;
      console.log(`AppUserService: getSubscriptionRole - User: ${user.uid}, Role: ${role}, Claims:`, tokenResult.claims);
      return role;
    } catch (e) {
      console.error('AppUserService: getSubscriptionRole - Error getting token result', e);
      return null;
    }
  }

  public async isPremium(): Promise<boolean> {
    console.log('AppUserService: Checking isPremium...');
    const role = await this.getSubscriptionRole();
    const isPremium = role === 'premium';
    console.log(`AppUserService: isPremium result: ${isPremium} (Role: ${role})`);
    return isPremium;
  }

  public async deleteAllUserData(user: User) {
    const serviceTokens = [
      { [ServiceNames.SuuntoApp]: await this.getServiceTokens(user, ServiceNames.SuuntoApp).pipe(take(1)).toPromise() },
      { [ServiceNames.COROSAPI]: await this.getServiceTokens(user, ServiceNames.COROSAPI).pipe(take(1)).toPromise() },
      { [ServiceNames.GarminHealthAPI]: await this.getGarminHealthAPITokens(user).pipe(take(1)).toPromise() }
    ].filter((serviceToken) => serviceToken[Object.keys(serviceToken)[0]]);
    for (const serviceToken of serviceTokens) {
      try {
        await this.deauthorizeService(<ServiceNames>Object.keys(serviceToken)[0]);
      } catch (e) {
        Sentry.captureException(e);
        console.error(`Could not deauthorize ${ServiceNames.SuuntoApp}`);
      }
    }

    try {
      const currentUser = this.auth.currentUser;
      if (currentUser) {
        return deleteUser(currentUser);
      }
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

  private getServiceTokens(user: User, serviceName: ServiceNames): Observable<any[]> {
    const serviceNamesToCollectionName = {
      [ServiceNames.SuuntoApp]: 'suuntoAppAccessTokens',
      [ServiceNames.COROSAPI]: 'COROSAPIAccessTokens'
    };
    const collectionRef = collection(this.firestore, serviceNamesToCollectionName[serviceName], user.uid, 'tokens');
    return collectionData(collectionRef).pipe(
      catchError(error => {
        return [];
      })
    );
  }

  private getGarminHealthAPITokens(user: User): Observable<any[]> {
    const docRef = doc(this.firestore, 'garminHealthAPITokens', user.uid);
    return docData(docRef).pipe(
      map(d => [d]),
      catchError(error => {
        return [];
      })
    );
  }

  public fillMissingAppSettings(user: User): UserSettingsInterface {
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
