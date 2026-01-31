import { inject, Injectable, EnvironmentInjector, runInInjectionContext, NgZone } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, shareReplay, switchMap, take } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Auth, authState, user, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, sendPasswordResetEmail, GoogleAuthProvider, GithubAuthProvider, FacebookAuthProvider, TwitterAuthProvider, OAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, fetchSignInMethodsForEmail, linkWithCredential, AuthCredential, linkWithPopup, AuthProvider, signInWithCustomToken } from '@angular/fire/auth';
import { Firestore, doc, onSnapshot, terminate, clearIndexedDbPersistence } from '@angular/fire/firestore';
import { Privacy, User } from '@sports-alliance/sports-lib';
import { AppUserService } from '../services/app.user.service';
import { LocalStorageService } from '../services/storage/app.local.storage.service';
import { LoggerService } from '../services/logger.service';
import { environment } from '../../environments/environment';

import { AppUserInterface } from '../models/app-user.interface';

@Injectable({
  providedIn: 'root'
})
export class AppAuthService {
  public user$: Observable<AppUserInterface | null>;
  public authState$: Observable<any | null>;
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
    this.user$ = user(this.auth).pipe(
      switchMap(firebaseUser => {
        if (firebaseUser) {
          return this.userService.getUserByID(firebaseUser.uid).pipe(
            switchMap((dbUser) => runInInjectionContext(this.injector, () => this.ensureFreshToken(firebaseUser, dbUser)))
          );
        } else {
          return of(null);
        }
      }),
      shareReplay(1)
    );
    this.user$.subscribe({
      error: err => console.error('[AppAuthService] user$ stream ERROR:', err),
      complete: () => console.warn('[AppAuthService] user$ stream COMPLETED')
    });
  }

  private async ensureFreshToken(firebaseUser: any, dbUser: User | null): Promise<User | null> {
    // Get current claims
    const tokenResult = await firebaseUser.getIdTokenResult();
    const stripeRole = tokenResult.claims['stripeRole'] as string || null;

    if (dbUser) {
      // Attach the uid to the object
      dbUser.uid = firebaseUser.uid;
      // Merge the stripe role from the token claims
      (dbUser as any).stripeRole = stripeRole;

      // Check if we need to force refresh the token
      // We do this if the DB says claims were updated AFTER our token was issued
      if ((dbUser as any).claimsUpdatedAt) {
        const claimsUpdatedAtUnformatted = (dbUser as any).claimsUpdatedAt;
        // Handle Firestore Timestamp or Date
        const claimsUpdatedAt = claimsUpdatedAtUnformatted.toDate ? claimsUpdatedAtUnformatted.toDate() : new Date(claimsUpdatedAtUnformatted.seconds * 1000);

        // iat (issued at) is in seconds
        const iatClaim = tokenResult.claims['iat'];
        const iat = typeof iatClaim === 'number' ? iatClaim : parseInt(String(iatClaim), 10);
        const iatMs = iat * 1000;

        // We need a buffer to prevent infinite loops if clocks are slightly off
        // If DB update is > iat + 5 seconds buffer, we refresh.
        if (claimsUpdatedAt.getTime() > iatMs + 2000) {
          this.logger.log(`[AppAuthService] Claims updated at ${claimsUpdatedAt.toISOString()} vs Token issued at ${new Date(iatMs).toISOString()}. Refreshing token...`);
          // Force refresh - wrapped in try-catch to handle failures gracefully
          try {
            await firebaseUser.getIdToken(true);
          } catch (e) {
            this.logger.error('[AppAuthService] Failed to refresh token', e);
            // Return the user anyway with potentially stale claims
            return dbUser;
          }
          // The user$ observable will re-emit because the token change triggers auth state change eventually?
          // Actually, getIdToken(true) does NOT trigger onAuthStateChanged by itself usually unless the user object reference changes.
          // But we are inside switchMap of user(this.auth).
          // If we just refreshed, the next emission might not happen automatically solely from this call
          // unless we manually trigger something or if the SDK internals do it.
          // However, we want to return the user with the NEW role.
          // So we should re-fetch the token result immediately to get the new role for *this* emission.

          const newTokenResult = await firebaseUser.getIdTokenResult();
          (dbUser as any).stripeRole = newTokenResult.claims['stripeRole'] as string || null;
          this.logger.log(`[AppAuthService] Token refreshed. New Role: ${(dbUser as any).stripeRole}`);
        }
      }
      return dbUser;
    } else {
      // Synthetic user for new accounts
      return {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
        photoURL: firebaseUser.photoURL,
        emailVerified: firebaseUser.emailVerified,
        settings: this.userService.fillMissingAppSettings({} as any),
        acceptedPrivacyPolicy: false,
        acceptedDataPolicy: false,
        acceptedTrackingPolicy: false,
        acceptedDiagnosticsPolicy: true, // Legitimate interest
        privacy: Privacy.Private,
        isAnonymous: false,
        stripeRole: stripeRole,
        claimsUpdatedAt: (dbUser as any)?.claimsUpdatedAt, // Pass it through if it exists on synthetic user (unlikely but good for types)
        creationDate: new Date(firebaseUser.metadata.creationTime!),
        lastSignInDate: new Date(firebaseUser.metadata.lastSignInTime!)
      } as unknown as User;
    }
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
    const actionCodeSettings = {
      // URL you want to redirect back to. The domain (www.example.com) for this
      // URL must be in the authorized domains list in the Firebase Console.
      url: window.location.origin + '/login',
      handleCodeInApp: true
    };

    try {
      await runInInjectionContext(this.injector, () => sendSignInLinkToEmail(this.auth, email, actionCodeSettings));
      this.localStorageService.setItem('emailForSignIn', email);
      this.snackBar.open(`Magic link sent to ${email} `, 'Close', {
        duration: 5000
      });
      return true;
    } catch (error: any) {
      this.handleError(error);
      return false;
    }
  }

  isSignInWithEmailLink(url: string): boolean {
    return runInInjectionContext(this.injector, () => isSignInWithEmailLink(this.auth, url));
  }

  async signInWithEmailLink(email: string, url: string) {
    try {
      const result = await runInInjectionContext(this.injector, () => signInWithEmailLink(this.auth, email, url));
      this.localStorageService.removeItem('emailForSignIn');
      return result;
    } catch (error: any) {
      this.handleError(error);
      throw error;
    }
  }

  //// Email/Password Auth ////

  async emailSignUp(email: string, password: string) {
    try {
      return runInInjectionContext(this.injector, () => createUserWithEmailAndPassword(this.auth, email, password));
    } catch (e: any) {
      this.handleError(e);
      throw e;
    }
  }

  async emailLogin(email: string, password: string) {
    try {
      return runInInjectionContext(this.injector, () => signInWithEmailAndPassword(this.auth, email, password));
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
    try {
      await runInInjectionContext(this.injector, () => sendPasswordResetEmail(this.auth, email));
      this.snackBar.open(`Password update email sent`, undefined, {
        duration: 2000
      });
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async signOut(): Promise<void> {
    await runInInjectionContext(this.injector, () => signOut(this.auth));
    await terminate(this.firestore);
    this.localStorageService.clearAllStorage();
    await clearIndexedDbPersistence(this.firestore);
    // Reload the page to reinitialize the app with a fresh Firestore instance
    // This is necessary because terminate() makes the current instance unusable
    window.location.href = '/login';
  }

  async fetchSignInMethods(email: string) {
    return runInInjectionContext(this.injector, () => fetchSignInMethodsForEmail(this.auth, email));
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
}
