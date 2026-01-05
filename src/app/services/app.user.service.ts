import { inject, Injectable, OnDestroy, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Observable, from, firstValueFrom, of, combineLatest, distinctUntilChanged } from 'rxjs';
import { StripeRole } from '../models/stripe-role.model';
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
import { Auth, authState } from '@angular/fire/auth';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { UserServiceMetaInterface } from '@sports-alliance/sports-lib';
import {
  DateRanges,
  TableSettings,
  UserDashboardSettingsInterface
} from '@sports-alliance/sports-lib';
import { AppUserInterface } from '../models/app-user.interface';
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
import { ServiceNames } from '@sports-alliance/sports-lib';
import { AppWindowService } from './app.window.service';
import { LoggerService } from './logger.service';
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
import { DataPeakEPOC } from '@sports-alliance/sports-lib';
import { DataAerobicTrainingEffect } from '@sports-alliance/sports-lib';
import { DataRecoveryTime } from '@sports-alliance/sports-lib';
import { Firestore, doc, docData, collection, collectionData, setDoc, updateDoc, getDoc } from '@angular/fire/firestore';
import { httpsCallableFromURL, Functions } from '@angular/fire/functions';


/**
 * @todo  break up to partners (Services) and user
 */
@Injectable({
  providedIn: 'root',
})
export class AppUserService implements OnDestroy {

  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private functions = inject(Functions);
  private injector = inject(EnvironmentInjector);

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

  public static readonly legalFields = [
    'acceptedPrivacyPolicy',
    'acceptedDataPolicy',
    'acceptedTrackingPolicy',
    'acceptedMarketingPolicy',
    'acceptedDiagnosticsPolicy',
    'acceptedTos',
  ];

  constructor(
    private eventService: AppEventService,
    private http: HttpClient,
    private windowService: AppWindowService,
    private logger: LoggerService
  ) {
    authState(this.auth).subscribe((user) => {
      if (user) {
        this.logger.setUser({ id: user.uid, email: user.email || undefined });
        user.getIdTokenResult().then((token) => {
          const role = token.claims['stripeRole'] as string;
          if (role) {
            this.logger.setTag("subscription_role", role);
          }
        });
      } else {
        this.logger.setUser(null);
        this.logger.setTag("subscription_role", "anonymous");
      }
    });
  }

  public getUserByID(userID: string): Observable<AppUserInterface | null> {
    return runInInjectionContext(this.injector, () => {
      const userDoc = doc(this.firestore, 'users', userID);
      const legalDoc = doc(this.firestore, `users/${userID}/legal/agreements`);
      const systemDoc = doc(this.firestore, `users/${userID}/system/status`);
      const settingsDoc = doc(this.firestore, `users/${userID}/config/settings`);

      return combineLatest({
        user: docData(userDoc),
        legal: docData(legalDoc).pipe(catchError((err) => { this.logger.error('Error fetching legal:', err); return of({}); })),
        system: docData(systemDoc).pipe(catchError((err) => { this.logger.error('Error fetching system:', err); return of({}); })),
        settings: docData(settingsDoc).pipe(catchError((err) => { this.logger.error('Error fetching settings:', err); return of({}); }))
      }).pipe(
        distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
        map(({ user, legal, system, settings }) => {
          if (!user) {
            return null;
          }

          // Merge all sources
          // Merge order: Main Doc -> Legal -> System (System overrides if overlap)
          const u = { ...user, ...(legal || {}), ...(system || {}) } as AppUserInterface;

          // Settings is a special case (nested object)
          if (settings && Object.keys(settings).length > 0) {
            u.settings = settings as any;
          }

          u.settings = this.fillMissingAppSettings(u);

          return u;
        }));
    });
  }

  public async createOrUpdateUser(user: AppUserInterface) {
    if (!user.acceptedPrivacyPolicy || !user.acceptedDataPolicy) {
      throw new Error('User has not accepted privacy or data policy');
    }
    // We must split writes for creation: 
    // 1. Write legal first (critical)
    await this.acceptPolicies(user);
    // 2. Write rest of user
    return this.updateUser(user);
  }

  public async acceptPolicies(policies: Partial<AppUserInterface>) {
    const dataToWrite: any = {};
    let hasChanges = false;
    AppUserService.legalFields.forEach(field => {
      if ((policies as any)[field] === true) {
        dataToWrite[field] = true;
        hasChanges = true;
      }
    });

    if (hasChanges) {
      return runInInjectionContext(this.injector, async () => {
        // Use set with merge true to allow "upsert" of the agreements doc
        await setDoc(doc(this.firestore, `users/${policies.uid}/legal/agreements`), dataToWrite, { merge: true });
      });
    }
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
    return runInInjectionContext(this.injector, () => {
      const metaDoc = doc(this.firestore, 'users', user.uid, 'meta', serviceName);
      return docData(metaDoc).pipe(map((d) => {
        return <UserServiceMetaInterface>d;
      }));
    });
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

  public async updateUserProperties(user: AppUserInterface, propertiesToUpdate: any) {
    return runInInjectionContext(this.injector, async () => {
      const promises = [];
      if (propertiesToUpdate.settings) {
        promises.push(setDoc(doc(this.firestore, `users/${user.uid}/config/settings`), propertiesToUpdate.settings, { merge: true }));
        delete propertiesToUpdate.settings;
      }

      // Handle legal fields separately
      const legalUpdates: any = {};
      AppUserService.legalFields.forEach(field => {
        if (field in propertiesToUpdate) {
          legalUpdates[field] = propertiesToUpdate[field];
          delete propertiesToUpdate[field];
        }
      });

      if (Object.keys(legalUpdates).length > 0) {
        promises.push(setDoc(doc(this.firestore, `users/${user.uid}/legal/agreements`), legalUpdates, { merge: true }));
      }

      if (Object.keys(propertiesToUpdate).length > 0) {
        promises.push(updateDoc(doc(this.firestore, 'users', user.uid), propertiesToUpdate));
      }

      await Promise.all(promises);
    });
  }

  public async updateUser(user: AppUserInterface) {
    const data = typeof user.toJSON === 'function' ? user.toJSON() : { ...user };

    // Filter out restricted fields that should live in sub-collections or system locations
    // This prevents accidental writes to the main doc and satisfying Security Rules
    const forbiddenFields = [
      'settings', // Now in config/settings
      'gracePeriodUntil',
      'lastDowngradedAt',
      'stripeRole',
      'isPro',
      ...AppUserService.legalFields
    ];

    forbiddenFields.forEach(field => delete (data as any)[field]);

    // Use setDoc with merge: true to handle both update and create (upsert) scenarios
    // This is critical for the "synthetic user" flow in onboarding where the doc might not exist yet.
    return runInInjectionContext(this.injector, async () => {
      const promises = [];

      // 1. Write Main User Doc
      promises.push(setDoc(doc(this.firestore, 'users', user.uid), data, { merge: true }));

      // 2. Write Settings to Subcollection
      if (user.settings) {
        promises.push(setDoc(doc(this.firestore, `users/${user.uid}/config/settings`), user.settings, { merge: true }));
      }

      await Promise.all(promises);
    });
  }

  public async setUserPrivacy(user: User, privacy: Privacy) {
    return this.updateUserProperties(user, { privacy: privacy });
  }

  public async setFreeTier(user: User) {
    // We update the user properties to set the role to 'free' (though role is usually claimed from token, 
    // for initial state we might want to store it or rely on the claim not being present/defaulting).
    // Actually, 'stripeRole' is a claim. We can't set it directly on the user object for Auth purposes client-side.
    // However, the guard checks `stripeRole` OR `isPro` OR `hasSubscribedOnce`.
    // If we want to allow "Free", we should explicitly set a flag or relying on the absence of a role 
    // being acceptable if they have "completed onboarding".
    // But the guard checks "hasPaidAccess".

    // Let's look at the guard again.
    // const hasPaidAccess = stripeRole === 'pro' || stripeRole === 'basic' || (user as any).isPro === true;
    // const onboardingCompleted = termsAccepted && (hasPaidAccess || hasSubscribedOnce);

    // We need to enable a way for 'free' users to pass.
    // We can set a property like 'onboardingCompleted' explicitly, but the guard calculates it dynamically 
    // based on roles.

    // Wait, the guard:
    // return onboardingCompleted;

    // So if I just set 'onboardingCompleted' property on the user in Firestore, 
    // does the guard read it?
    // The guard code:
    // const onboardingCompleted = termsAccepted && (hasPaidAccess || hasSubscribedOnce);

    // The guard DOES NOT read a 'onboardingCompleted' flag from the DB user object to determine success.
    // It logic is hardcoded.

    // So I need to change the guard first/also.
    // But for this service method, I should probably set a flag that indicates they chose the free tier.
    // Maybe `acceptedFreeTier: true`? Or just ensuring `onboardingCompleted: true` is set 
    // and valid for the guard.

    // Let's set 'onboardingCompleted: true' in the DB (standard practice) 
    // AND maybe a local property if needed. 
    // But most importantly, the guard needs to be updated to respect "Free" choice.

    return this.updateUserProperties(user, {
      onboardingCompleted: true,

    });
  }

  public async isBranded(user: User): Promise<boolean> {
    const privDoc = runInInjectionContext(this.injector, () => doc(this.firestore, 'userAccountPrivileges', user.uid));
    return firstValueFrom(from(runInInjectionContext(this.injector, () => getDoc(privDoc))).pipe(map((doc) => {
      if (!doc.exists()) {
        return false;
      }
      return doc.data()['isBranded'];
    })));
  }


  // ...

  public async getSubscriptionRole(): Promise<StripeRole | null> {
    const user = await runInInjectionContext(this.injector, () => firstValueFrom(authState(this.auth).pipe(take(1))));
    if (!user) {
      this.logger.warn('AppUserService: getSubscriptionRole - No current user');
      return null;
    }
    try {
      // Use cached token result unless explicitly told otherwise to avoid infinite loops
      // by triggering auth state changes during an auth subscription.
      const tokenResult = await user.getIdTokenResult();
      this.logger.log('[AppUserService] DEBUG: Full Token Result:', tokenResult);
      this.logger.log('[AppUserService] DEBUG: Custom Claims:', tokenResult.claims);
      const role = (tokenResult.claims['stripeRole'] as StripeRole) || null;
      this.logger.log(`AppUserService: getSubscriptionRole - User: ${user.uid}, Role: ${role}`);
      return role;
    } catch (e) {
      this.logger.error('AppUserService: getSubscriptionRole - Error getting token result', e);
      return null;
    }
  }

  public async isBasic(): Promise<boolean> {
    const role = await this.getSubscriptionRole();
    return role === 'basic';
  }

  public async isPro(): Promise<boolean> {
    const isAdmin = await this.isAdmin();
    if (isAdmin) return true;
    const role = await this.getSubscriptionRole();
    return role === 'pro';
  }

  public async isAdmin(): Promise<boolean> {
    const user = await runInInjectionContext(this.injector, () => firstValueFrom(authState(this.auth).pipe(take(1))));
    if (!user) {
      return false;
    }
    try {
      const tokenResult = await user.getIdTokenResult();
      return tokenResult.claims['admin'] === true;
    } catch (e) {
      this.logger.error('AppUserService: isAdmin - Error getting token result', e);
      return false;
    }
  }

  /**
   * Returns true if the user has any level of paid access (basic or pro)
   */
  public async hasPaidAccess(): Promise<boolean> {
    const isAdmin = await this.isAdmin();
    if (isAdmin) return true;
    const role = await this.getSubscriptionRole();
    return role === 'pro' || role === 'basic';
  }

  public getGracePeriodUntil(): Observable<Date | null> {
    const user = this.auth.currentUser;
    this.logger.log('[AppUserService] getGracePeriodUntil - Current auth user:', user?.uid || 'null');
    if (!user) return from([null]);

    return runInInjectionContext(this.injector, () => {
      // Logic refactored: gracePeriodUntil is now in system/status and merged onto user
      // so this can technically just call getUserByID, but that's heavy.
      // Let's read directly from system/status for efficiency
      const systemDoc = doc(this.firestore, `users/${user.uid}/system/status`);
      return docData(systemDoc).pipe(
        map((systemData: any) => {
          if (systemData?.gracePeriodUntil) {
            // Firebase Timestamp to Date
            const date = (systemData.gracePeriodUntil as any).toDate();
            // this.logger.log('[AppUserService] getGracePeriodUntil - Returning grace period date:', date);
            return date;
          }
          return null;
        }),
        catchError((error) => {
          this.logger.error('[AppUserService] getGracePeriodUntil - Error fetching system document:', error);
          return from([null]);
        })
      );
    });
  }

  public async deleteAllUserData(user: User) {
    try {
      const deleteSelf = httpsCallableFromURL(this.functions, environment.functions.deleteSelf);
      await deleteSelf();
      await this.auth.signOut();
    } catch (e) {
      this.logger.error(e);
      throw e;
    }
  }
  public getUserChartDataTypesToUse(user: User): string[] {
    if (!user.settings?.chartSettings?.dataTypeSettings) {
      return [];
    }
    return Object.keys(user.settings.chartSettings.dataTypeSettings).reduce<string[]>((dataTypesToUse, dataTypeSettingsKey) => {
      if (user.settings.chartSettings.dataTypeSettings[dataTypeSettingsKey].enabled === true) {
        dataTypesToUse.push(dataTypeSettingsKey);
      }
      return dataTypesToUse;
    }, [])
  }

  ngOnDestroy() {
  }

  private getServiceTokens(user: User, serviceName: ServiceNames): Observable<any[]> {
    const serviceNamesToCollectionName: Partial<Record<ServiceNames, string>> = {
      [ServiceNames.SuuntoApp]: 'suuntoAppAccessTokens',
      [ServiceNames.COROSAPI]: 'COROSAPIAccessTokens'
    };
    const collectionName = serviceNamesToCollectionName[serviceName];
    if (!collectionName) return from([]);

    return runInInjectionContext(this.injector, () => {
      const collectionRef = collection(this.firestore, collectionName, user.uid, 'tokens');
      return collectionData(collectionRef).pipe(
        catchError(() => {
          return [];
        })
      );
    });
  }

  private getGarminHealthAPITokens(user: User): Observable<any[]> {
    return runInInjectionContext(this.injector, () => {
      const docRef = doc(this.firestore, 'garminHealthAPITokens', user.uid);
      return docData(docRef).pipe(
        map(d => [d]),
        catchError(() => {
          return [];
        })
      );
    });
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
