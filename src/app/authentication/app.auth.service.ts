import { inject, Injectable, EnvironmentInjector, runInInjectionContext, NgZone } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, shareReplay, switchMap, take } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Auth, authState, user, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, sendPasswordResetEmail, GoogleAuthProvider, GithubAuthProvider, FacebookAuthProvider, TwitterAuthProvider, OAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, fetchSignInMethodsForEmail, linkWithCredential, AuthCredential, linkWithPopup, AuthProvider, signInWithCustomToken, User as FirebaseAuthUser } from '@angular/fire/auth';
import { Firestore, clearIndexedDbPersistence, terminate } from '@angular/fire/firestore';
import { Privacy, User } from '@sports-alliance/sports-lib';
import { AppUserService } from '../services/app.user.service';
import { LocalStorageService } from '../services/storage/app.local.storage.service';
import { LoggerService } from '../services/logger.service';
import { environment } from '../../environments/environment';
import {
  APP_LOGIN_PATH,
  buildAppUrl,
  canUseCustomAuthLinkDomain,
  normalizeUrlOrHost
} from '../shared/adapters/firebase-auth-link.constants';

import { AppUserInterface } from '../models/app-user.interface';

@Injectable({
  providedIn: 'root'
})
export class AppAuthService {
  public user$: Observable<AppUserInterface | null>;
  public authState$: Observable<FirebaseAuthUser | null>;
  // store the URL so we can redirect after logging in
  redirectUrl: string = '';

  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private injector = inject(EnvironmentInjector);
  private zone = inject(NgZone);

  get currentUser() {
    return this.auth.currentUser;
  }

  constructor(
    private userService: AppUserService,
    private snackBar: MatSnackBar,
    public localStorageService: LocalStorageService,
    private logger: LoggerService
  ) {
    /* 
     * NOTE on runInInjectionContext:
     * Firebase v9+ Modular SDK methods (signInWithPopup, etc.) must be called within an Injection Context
     * to allow AngularFire to correctly track Zones for change detection.
     * Since these methods are often called asynchronously from user actions (outside constructor),
     * we manually wrap them.
     */
    this.authState$ = authState(this.auth);

    // Use modular user observable to react to token refreshes too
    this.user$ = this.userService.user$;
    this.user$.subscribe({
      error: err => this.logger.error(
        '[AppAuthService] user$ stream ERROR',
        {
          currentUserUid: this.auth.currentUser?.uid ?? null,
          currentUserEmail: this.maskEmailForLogs(this.auth.currentUser?.email),
          code: err?.code ?? null,
          message: err?.message ?? null
        },
        err
      ),
      complete: () => this.logger.warn('[AppAuthService] user$ stream COMPLETED')
    });
  }


  /*
   * Get the current user value (snapshot) from the observable
   */
  async getUser(): Promise<User | null> {
    const user = await this.user$.pipe(take(1)).toPromise();
    return user || null;
  }

  // Get the underlying Firebase Auth instance for modular functions
  // In modular, this.auth IS the instance. Keeping wrapper for compatibility if needed.
  private async getAuthInstance() {
    return this.auth;
  }

  /**
   * Sign in with a given OAuth provider.
   * - Localhost: Use popup (works in Safari, Chrome needs cookie exception)
   * - Production: Use redirect (better mobile experience, avoids popup blockers)
   */
  public async signInWithProvider(provider: AuthProvider) {
    this.logger.log('[Auth] signInWithProvider - localhost:', environment.localhost);
    try {
      if (environment.localhost) {
        this.logger.log('[Auth] Using popup...');
        const result = await runInInjectionContext(this.injector, () => signInWithPopup(this.auth, provider));
        this.logger.log('[Auth] Popup succeeded:', result);
        return result;
      } else {
        this.logger.log('[Auth] Using redirect...');
        return await runInInjectionContext(this.injector, () => signInWithRedirect(this.auth, provider));
      }
    } catch (error: any) {
      this.logger.error('[Auth] signInWithProvider error:', error);
      this.logger.error('[Auth] Error code:', error?.code);
      this.logger.error('[Auth] Error message:', error?.message);
      throw error;
    }
  }

  public async signInWithPopup(provider: AuthProvider) {
    return runInInjectionContext(this.injector, () => signInWithPopup(this.auth, provider));
  }

  async googleLogin() {
    const provider = new GoogleAuthProvider();
    return this.signInWithProvider(provider);
  }

  async githubLogin() {
    const provider = new GithubAuthProvider();
    return this.signInWithProvider(provider);
  }

  async getRedirectResult() {
    return runInInjectionContext(this.injector, () => getRedirectResult(this.auth));
  }





  //// Email Link Auth ////

  async sendEmailLink(email: string) {
    const actionCodeSettings = this.buildActionCodeSettings(true);
    this.logger.log('[Auth][EmailLink] sendEmailLink:start', {
      email: this.maskEmailForLogs(email),
      actionCodeSettings: this.getActionCodeSettingsLogContext(actionCodeSettings)
    });

    try {
      await runInInjectionContext(this.injector, () => sendSignInLinkToEmail(this.auth, email, actionCodeSettings));
      this.localStorageService.setItem('emailForSignIn', email);
      this.logger.log('[Auth][EmailLink] sendEmailLink:success', {
        email: this.maskEmailForLogs(email),
        cachedEmailSaved: true
      });
      this.snackBar.open(`Magic link sent to ${email} `, 'Close', {
        duration: 5000
      });
      return true;
    } catch (error: any) {
      this.logger.error('[Auth][EmailLink] sendEmailLink:error', {
        email: this.maskEmailForLogs(email),
        actionCodeSettings: this.getActionCodeSettingsLogContext(actionCodeSettings),
        code: error?.code ?? null,
        message: error?.message ?? null
      }, error);
      this.handleError(error);
      return false;
    }
  }

  isSignInWithEmailLink(url: string): boolean {
    const result = runInInjectionContext(this.injector, () => isSignInWithEmailLink(this.auth, url));
    this.logger.log('[Auth][EmailLink] isSignInWithEmailLink:result', {
      result,
      link: this.getEmailLinkLogContext(url)
    });
    return result;
  }

  async signInWithEmailLink(email: string, url: string) {
    const cachedEmail = this.localStorageService.getItem('emailForSignIn');
    this.logger.log('[Auth][EmailLink] signInWithEmailLink:start', {
      email: this.maskEmailForLogs(email),
      cachedEmailPresent: !!cachedEmail,
      cachedEmailMatches: cachedEmail === email,
      link: this.getEmailLinkLogContext(url)
    });

    try {
      const result = await runInInjectionContext(this.injector, () => signInWithEmailLink(this.auth, email, url));
      this.localStorageService.removeItem('emailForSignIn');
      this.logger.log('[Auth][EmailLink] signInWithEmailLink:success', {
        email: this.maskEmailForLogs(email),
        uid: result?.user?.uid ?? null,
        emailVerified: result?.user?.emailVerified ?? null
      });
      return result;
    } catch (error: any) {
      this.logger.error('[Auth][EmailLink] signInWithEmailLink:error', {
        email: this.maskEmailForLogs(email),
        cachedEmailPresent: !!cachedEmail,
        cachedEmailMatches: cachedEmail === email,
        link: this.getEmailLinkLogContext(url),
        code: error?.code ?? null,
        message: error?.message ?? null
      }, error);
      this.handleError(error);
      throw error;
    }
  }

  //// Email/Password Auth ////

  async emailSignUp(email: string, password: string) {
    try {
      return await runInInjectionContext(this.injector, () => createUserWithEmailAndPassword(this.auth, email, password));
    } catch (e: any) {
      this.handleError(e);
      throw e;
    }
  }

  async emailLogin(email: string, password: string) {
    try {
      return await runInInjectionContext(this.injector, () => signInWithEmailAndPassword(this.auth, email, password));
    } catch (e: any) {
      this.handleError(e);
      throw e;
    }
  }

  async loginWithCustomToken(token: string) {
    try {
      return await runInInjectionContext(this.injector, () => signInWithCustomToken(this.auth, token));
    } catch (e: any) {
      this.handleError(e);
      throw e;
    }
  }

  // Sends email allowing user to reset password
  async resetPassword(email: string) {
    const actionCodeSettings = this.buildActionCodeSettings(false);

    try {
      await runInInjectionContext(this.injector, () => sendPasswordResetEmail(this.auth, email, actionCodeSettings));
      this.snackBar.open(`Password update email sent`, undefined, {
        duration: 2000
      });
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async signOut(): Promise<void> {
    await runInInjectionContext(this.injector, () => signOut(this.auth));
    await runInInjectionContext(this.injector, () => terminate(this.firestore));
    this.localStorageService.clearAllStorage();
    await runInInjectionContext(this.injector, () => clearIndexedDbPersistence(this.firestore));
    this.redirectToLogin();
  }

  async fetchSignInMethods(email: string) {
    this.logger.log('[Auth] fetchSignInMethods:start', {
      email: this.maskEmailForLogs(email)
    });

    try {
      const methods = await runInInjectionContext(this.injector, () => fetchSignInMethodsForEmail(this.auth, email));
      this.logger.log('[Auth] fetchSignInMethods:success', {
        email: this.maskEmailForLogs(email),
        methods
      });
      return methods;
    } catch (error: any) {
      this.logger.error('[Auth] fetchSignInMethods:error', {
        email: this.maskEmailForLogs(email),
        code: error?.code ?? null,
        message: error?.message ?? null
      }, error);
      throw error;
    }
  }

  async linkCredential(user: any, credential: AuthCredential) {
    return runInInjectionContext(this.injector, () => linkWithCredential(user, credential));
  }

  async linkWithPopup(user: any, provider: AuthProvider) {
    return runInInjectionContext(this.injector, () => linkWithPopup(user, provider));
  }

  getProviderForId(providerId: string) {
    switch (providerId) {
      case GoogleAuthProvider.PROVIDER_ID:
        return new GoogleAuthProvider();
      case GithubAuthProvider.PROVIDER_ID:
        return new GithubAuthProvider();
      case FacebookAuthProvider.PROVIDER_ID:
        return new FacebookAuthProvider();
      case TwitterAuthProvider.PROVIDER_ID:
        return new TwitterAuthProvider();
      default:
        throw new Error(`Unsupported provider ID: ${providerId}`);
    }
  }

  // If error, console log and notify user
  private handleError(error: Error) {
    this.logger.error(error);
    this.snackBar.open(`Could not login due to error ${error.message} `, undefined, {
      duration: 2000
    });
  }

  private redirectToLogin(): void {
    window.location.href = APP_LOGIN_PATH;
  }

  private getLoginActionUrl(): string {
    const baseUrl = normalizeUrlOrHost(environment.appUrl) || window.location.origin;
    return buildAppUrl(baseUrl, APP_LOGIN_PATH, {
      preferHttpsForLocalhost: environment.localhost
    });
  }

  private maskEmailForLogs(email: string | null | undefined): string {
    if (!email) {
      return '(missing)';
    }

    const [localPart, domainPart] = email.split('@');
    if (!domainPart) {
      return `${email.slice(0, 2)}***`;
    }

    const maskedLocalPart = localPart.length <= 2
      ? `${localPart.charAt(0)}*`
      : `${localPart.slice(0, 2)}***`;

    return `${maskedLocalPart}@${domainPart}`;
  }

  private getEmailLinkLogContext(url: string): Record<string, string | boolean | null> {
    try {
      const parsedUrl = new URL(url);
      return {
        origin: parsedUrl.origin,
        pathname: parsedUrl.pathname,
        mode: parsedUrl.searchParams.get('mode'),
        hasOobCode: parsedUrl.searchParams.has('oobCode'),
        hasApiKey: parsedUrl.searchParams.has('apiKey'),
        hasContinueUrl: parsedUrl.searchParams.has('continueUrl'),
        hasLang: parsedUrl.searchParams.has('lang')
      };
    } catch {
      return {
        origin: null,
        pathname: null,
        mode: null,
        hasOobCode: false,
        hasApiKey: false,
        hasContinueUrl: false,
        hasLang: false
      };
    }
  }

  private getActionCodeSettingsLogContext(
    actionCodeSettings: { url: string; handleCodeInApp?: boolean; linkDomain?: string }
  ): { url: string; handleCodeInApp: boolean; linkDomain: string | null } {
    return {
      url: actionCodeSettings.url,
      handleCodeInApp: actionCodeSettings.handleCodeInApp === true,
      linkDomain: actionCodeSettings.linkDomain ?? null
    };
  }

  private buildActionCodeSettings(handleCodeInApp: boolean): { url: string; handleCodeInApp?: boolean; linkDomain?: string } {
    const actionCodeSettings: { url: string; handleCodeInApp?: boolean; linkDomain?: string } = {
      url: this.getLoginActionUrl()
    };

    if (handleCodeInApp) {
      actionCodeSettings.handleCodeInApp = true;
    }

    const linkDomain = this.getHostingLinkDomain();
    if (linkDomain) {
      actionCodeSettings.linkDomain = linkDomain;
    }

    return actionCodeSettings;
  }

  private getHostingLinkDomain(): string | undefined {
    if (environment.localhost) {
      return undefined;
    }

    const authDomain = normalizeUrlOrHost(environment.firebase?.authDomain);
    if (!authDomain) {
      return undefined;
    }

    if (!canUseCustomAuthLinkDomain(authDomain)) {
      return undefined;
    }

    return authDomain;
  }
}
