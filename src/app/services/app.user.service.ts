import { inject, Injectable, OnDestroy, EnvironmentInjector, runInInjectionContext, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';


import { Observable, from, firstValueFrom, of, combineLatest, distinctUntilChanged } from 'rxjs';
import { StripeRole } from '../models/stripe-role.model';
import { User } from '@sports-alliance/sports-lib';
import { Privacy } from '@sports-alliance/sports-lib';
import { AppEventService } from './app.event.service';
import { catchError, map, take, switchMap, shareReplay } from 'rxjs/operators';
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
import { Auth, authState, user } from '@angular/fire/auth';
import { HttpClient } from '@angular/common/http';
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
import { AppUserUtilities } from '../utils/app.user.utilities';
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
import { Firestore, doc, docData, collection, collectionData, setDoc, updateDoc } from '@angular/fire/firestore';
import { AppFunctionsService } from './app.functions.service';
import { FunctionName } from '../../shared/functions-manifest';


/**
 * Service for managing user data, subscription roles, and settings.
 * Handles merging Firebase Authentication data with Firestore user profiles.
 * Provides reactive signals for user state across the application.
 */
@Injectable({
  providedIn: 'root',
})
export class AppUserService implements OnDestroy {

  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private functionsService = inject(AppFunctionsService);
  private injector = inject(EnvironmentInjector);
  private logger = inject(LoggerService);
  private eventService = inject(AppEventService);
  private http = inject(HttpClient);
  private windowService = inject(AppWindowService);

  public readonly user$ = runInInjectionContext(this.injector, () => user(this.auth).pipe(
    switchMap(u => {
      if (!u) return of(null);
      return this.getUserByID(u.uid).pipe(
        switchMap(dbUser => from(this.mergeClaims(u, dbUser)))
      );
    }),
    distinctUntilChanged((p, c) => JSON.stringify(p) === JSON.stringify(c)),
    shareReplay(1)
  ));

  /**
   * Merges Firebase Auth User claims (stripeRole, gracePeriodUntil) with Firestore database data.
   * Also handles force-refreshing the ID token if claims are outdated.
   */
  private async mergeClaims(firebaseUser: any, dbUser: AppUserInterface | null): Promise<AppUserInterface | null> {
    const tokenResult = await firebaseUser.getIdTokenResult();
    const claims = tokenResult.claims;
    const stripeRole = (claims['stripeRole'] as StripeRole) || null;
    const gracePeriodUntil = (claims['gracePeriodUntil'] as number) || null;
    const isAdmin = claims['admin'] === true;

    // Use current DB user or create a synthetic one for new accounts/loading states
    const identity: AppUserInterface = dbUser ? { ...dbUser } : {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      photoURL: firebaseUser.photoURL,
      emailVerified: firebaseUser.emailVerified,
      settings: AppUserUtilities.fillMissingAppSettings({} as any),
      acceptedPrivacyPolicy: false,
      acceptedDataPolicy: false,
      acceptedTrackingPolicy: false,
      acceptedDiagnosticsPolicy: true,
      privacy: Privacy.Private,
      isAnonymous: false,
      creationDate: new Date(firebaseUser.metadata.creationTime!),
      lastSignInDate: new Date(firebaseUser.metadata.lastSignInTime!)
    } as any;

    // Prioritize Claims for role and grace period, but fallback to DB data if claims are missing
    identity.uid = firebaseUser.uid;
    if (stripeRole) {
      (identity as any).stripeRole = stripeRole;
    }
    if (gracePeriodUntil) {
      (identity as any).gracePeriodUntil = gracePeriodUntil;
    }
    if (isAdmin) {
      (identity as any).admin = true;
    }

    // Check for force-refresh (if DB was updated more recently than token issuance)
    const claimsUpdatedAt = (identity as any).claimsUpdatedAt;
    if (claimsUpdatedAt) {
      const updatedAtDate = claimsUpdatedAt.toDate ? claimsUpdatedAt.toDate() : new Date(claimsUpdatedAt.seconds * 1000);
      const iat = (claims['iat'] as number) * 1000;
      if (updatedAtDate.getTime() > iat + 2000) {
        this.logger.log(`[AppUserService] Refreshing token for ${firebaseUser.uid}...`);
        try {
          await firebaseUser.getIdToken(true);
          const freshToken = await firebaseUser.getIdTokenResult();
          const freshStripeRole = freshToken.claims['stripeRole'] as StripeRole;
          const freshGracePeriodUntil = freshToken.claims['gracePeriodUntil'] as number;
          if (freshStripeRole) {
            (identity as any).stripeRole = freshStripeRole;
          }
          if (freshGracePeriodUntil) {
            (identity as any).gracePeriodUntil = freshGracePeriodUntil;
          }
        } catch (e) {
          this.logger.error('[AppUserService] Token refresh failed', e);
        }
      }
    }

    return identity;
  }

  public readonly user = toSignal(this.user$,
    { initialValue: null, injector: this.injector }
  );

  public readonly stripeRoleSignal = computed(() => (this.user() as any)?.stripeRole as StripeRole || null);
  public readonly isAdminSignal = computed(() => (this.user() as any)?.admin === true);
  public readonly isProSignal = computed(() => AppUserUtilities.hasProAccess(this.user(), this.isAdminSignal()));
  public readonly isBasicSignal = computed(() => AppUserUtilities.isBasicUser(this.user()));

  public readonly isGracePeriodActiveSignal = computed(() => AppUserUtilities.isGracePeriodActive(this.user()));
  public readonly hasPaidAccessSignal = computed(() => AppUserUtilities.hasPaidAccessUser(this.user(), this.isAdminSignal()));
  public readonly hasProAccessSignal = computed(() => AppUserUtilities.hasProAccess(this.user(), this.isAdminSignal()));

  public readonly gracePeriodUntil = computed(() => {
    const user = this.user();
    if (!user) return null;
    const gracePeriodUntil = (user as any).gracePeriodUntil;
    if (!gracePeriodUntil) return null;
    // Handle Firestore Timestamp
    if (typeof gracePeriodUntil.toDate === 'function') {
      return gracePeriodUntil.toDate();
    }
    // Handle seconds/nanoseconds object
    if (typeof gracePeriodUntil === 'object' && gracePeriodUntil.seconds) {
      return new Date(gracePeriodUntil.seconds * 1000);
    }
    // Handle Date or number
    return new Date(gracePeriodUntil);
  });

  public async getSubscriptionRole(): Promise<StripeRole | null> {
    const user = await firstValueFrom(this.user$.pipe(take(1)));
    return (user as any)?.stripeRole as StripeRole || null;
  }

  public async isPro(): Promise<boolean> {
    const user = await firstValueFrom(this.user$.pipe(take(1)));
    const isAdmin = (user as any)?.admin === true;
    return AppUserUtilities.hasProAccess(user, isAdmin);
  }

  public async hasProAccess(): Promise<boolean> {
    return this.isPro();
  }

  public async hasPaidAccess(): Promise<boolean> {
    const user = await firstValueFrom(this.user$.pipe(take(1)));
    const isAdmin = (user as any)?.admin === true;
    return AppUserUtilities.hasPaidAccessUser(user, isAdmin);
  }

  public static readonly legalFields = [
    'acceptedPrivacyPolicy',
    'acceptedDataPolicy',
    'acceptedTrackingPolicy',
    'acceptedMarketingPolicy',
    'acceptedDiagnosticsPolicy',
    'acceptedTos',
  ];



  constructor() {
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
      const userDoc = doc(this.firestore, 'users', userID) as any;
      const legalDoc = doc(this.firestore, `users/${userID}/legal/agreements`) as any;
      const systemDoc = doc(this.firestore, `users/${userID}/system/status`) as any;
      const settingsDoc = doc(this.firestore, `users/${userID}/config/settings`) as any;

      return combineLatest({
        user: docData(userDoc) as Observable<AppUserInterface | null>,
        legal: (docData(legalDoc) as Observable<any>).pipe(catchError((err) => { this.logger.error('Error fetching legal:', err); return of({}); })),
        system: (docData(systemDoc) as Observable<any>).pipe(catchError((err) => { this.logger.error('Error fetching system:', err); return of({}); })),
        settings: (docData(settingsDoc) as Observable<any>).pipe(catchError((err) => { this.logger.error('Error fetching settings:', err); return of({}); }))
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

          u.settings = AppUserUtilities.fillMissingAppSettings(u);

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
      case ServiceNames.GarminAPI:
        return this.getGarminAPITokens(user);
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
    let functionName: FunctionName;
    let payload: any;

    switch (serviceName) {
      case ServiceNames.COROSAPI:
        functionName = 'addCOROSAPIHistoryToQueue';
        payload = { startDate, endDate };
        break;
      case ServiceNames.GarminAPI:
        functionName = 'backfillGarminAPIActivities';
        payload = { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
        break;
      case ServiceNames.SuuntoApp:
        functionName = 'addSuuntoAppHistoryToQueue';
        payload = { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
        break;
      default:
        throw new Error(`Service ${serviceName} not supported for history import`);
    }

    const result = await this.functionsService.call(functionName, payload);
    return result.data;
  }

  async deauthorizeService(serviceName: ServiceNames): Promise<any> {
    let functionName: FunctionName;

    switch (serviceName) {
      case ServiceNames.GarminAPI:
        functionName = 'deauthorizeGarminAPI';
        break;
      case ServiceNames.COROSAPI:
        functionName = 'deauthorizeCOROSAPI';
        break;
      case ServiceNames.SuuntoApp:
        functionName = 'deauthorizeSuuntoApp';
        break;
      default:
        throw new Error(`Service ${serviceName} not supported for deauthorization`);
    }

    const result = await this.functionsService.call(functionName);
    return result.data;
  }

  async getCurrentUserServiceTokenAndRedirectURI(serviceName: ServiceNames): Promise<{ redirect_uri: string }> {
    const currentDomain = this.windowService.currentDomain;
    const redirectUri = encodeURI(`${currentDomain}/services?serviceName=${serviceName}&connect=1`);
    let functionName: FunctionName;

    switch (serviceName) {
      case ServiceNames.GarminAPI:
        functionName = 'getGarminAPIAuthRequestTokenRedirectURI';
        break;
      case ServiceNames.COROSAPI:
        functionName = 'getCOROSAPIAuthRequestTokenRedirectURI';
        break;
      case ServiceNames.SuuntoApp:
        functionName = 'getSuuntoAPIAuthRequestTokenRedirectURI';
        break;
      default:
        throw new Error(`Service ${serviceName} not supported for auth redirect`);
    }

    const result = await this.functionsService.call<{ redirectUri: string }, { redirect_uri: string }>(functionName, { redirectUri });
    return result.data;
  }

  public async requestAndSetCurrentUserGarminAPIAccessToken(state: string, code: string) {
    const currentDomain = this.windowService.currentDomain;
    const redirectUri = encodeURI(`${currentDomain}/services?serviceName=${ServiceNames.GarminAPI}&connect=1`);
    const result = await this.functionsService.call('requestAndSetGarminAPIAccessToken', {
      state,
      code,
      redirectUri,
    });
    return result.data;
  }

  public async requestAndSetCurrentUserSuuntoAppAccessToken(state: string, code: string) {
    const currentDomain = this.windowService.currentDomain;
    const redirectUri = encodeURI(`${currentDomain}/services?serviceName=${ServiceNames.SuuntoApp}&connect=1`);
    const result = await this.functionsService.call<{ state: string; code: string; redirectUri: string }, void>(
      'requestAndSetSuuntoAPIAccessToken',
      { state, code, redirectUri }
    );
    return result.data;
  }

  public async requestAndSetCurrentUserCOROSAPIAccessToken(state: string, code: string) {
    const currentDomain = this.windowService.currentDomain;
    const redirectUri = encodeURI(`${currentDomain}/services?serviceName=${ServiceNames.COROSAPI}&connect=1`);
    const result = await this.functionsService.call<{ state: string; code: string; redirectUri: string }, void>(
      'requestAndSetCOROSAPIAccessToken',
      { state, code, redirectUri }
    );
    return result.data;
  }

  public async updateUserProperties(user: AppUserInterface, propertiesToUpdate: any) {
    return runInInjectionContext(this.injector, async () => {
      const promises = [];
      if (propertiesToUpdate.settings) {
        promises.push(setDoc(doc(this.firestore, `users/${user.uid}/config/settings`), propertiesToUpdate.settings, { merge: true })
          .catch(err => {
            this.logger.error('[AppUserService] Settings update FAILED', err);
            throw err;
          })
        );
        delete propertiesToUpdate.settings;
      }

      // Handle legal fields separately
      const legalUpdates: any = {};
      const allowedLegalUpdates = ['acceptedTrackingPolicy', 'acceptedMarketingPolicy'];

      // First strip all legal fields from propertiesToUpdate to ensure they don't land in the main doc
      AppUserService.legalFields.forEach(field => {
        if (field in propertiesToUpdate) {
          // Only allow specific legal fields to be updated via this method
          if (allowedLegalUpdates.includes(field)) {
            legalUpdates[field] = propertiesToUpdate[field];
          } else {
            this.logger.warn(`[AppUserService] Stripping restricted legal field '${field}' from update payload.`);
          }
          delete propertiesToUpdate[field];
        }
      });

      if (Object.keys(legalUpdates).length > 0) {
        promises.push(setDoc(doc(this.firestore, `users/${user.uid}/legal/agreements`), legalUpdates, { merge: true })
          .catch(err => {
            this.logger.error('[AppUserService] Legal update FAILED', err);
            throw err;
          })
        );
      }

      if (Object.keys(propertiesToUpdate).length > 0) {
        promises.push(updateDoc(doc(this.firestore, 'users', user.uid), propertiesToUpdate)
          .catch(err => {
            this.logger.error('[AppUserService] Main user doc update FAILED', err);
            throw err;
          })
        );
      }

      try {
        await Promise.all(promises);
      } catch (e) {
        this.logger.error('[AppUserService] One or more updates failed', e);
        throw e;
      }
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



  // ...

  public async isAdmin(): Promise<boolean> {
    const user = await firstValueFrom(this.user$.pipe(take(1)));
    return (user as any)?.admin === true;
  }


  public async deleteAllUserData(_user: User) {
    try {
      await this.functionsService.call('deleteSelf');
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
    // Required to satisfy OnDestroy interface
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

  private getGarminAPITokens(user: User): Observable<any[]> {
    return runInInjectionContext(this.injector, () => {
      // Garmin tokens are stored in: garminAPITokens/{userID}/tokens/{garminUserID}
      const collectionRef = collection(this.firestore, 'garminAPITokens', user.uid, 'tokens');
      return collectionData(collectionRef).pipe(
        catchError(() => {
          return [];
        })
      );
    });
  }

}
