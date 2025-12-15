import { inject, Injectable, EnvironmentInjector, runInInjectionContext, NgZone } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, shareReplay, switchMap, take } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Auth, authState, signInWithRedirect, signInWithPopup, getRedirectResult, signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, GoogleAuthProvider, GithubAuthProvider, FacebookAuthProvider, TwitterAuthProvider, getAuth } from '@angular/fire/auth';
import { Firestore, doc, onSnapshot, terminate, clearIndexedDbPersistence } from '@angular/fire/firestore';
import { User } from '@sports-alliance/sports-lib';
import { AppUserService } from '../services/app.user.service';
import { Analytics } from '@angular/fire/analytics';
import { LocalStorageService } from '../services/storage/app.local.storage.service';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AppAuthService {
  public user$: Observable<User | null>;
  // store the URL so we can redirect after logging in
  redirectUrl: string;

  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private analytics = inject(Analytics);
  private injector = inject(EnvironmentInjector);
  private zone = inject(NgZone);

  constructor(
    private userService: AppUserService,
    private snackBar: MatSnackBar,
    private localStorageService: LocalStorageService
  ) {
    // Use modular authState to stay in injection context
    this.user$ = authState(this.auth).pipe(
      switchMap(user => {
        if (user) {
          return new Observable<User | null>(observer => {
            const userDoc = doc(this.firestore, `users/${user.uid}`);
            const unsubscribe = onSnapshot(userDoc, (snap) => {
              const dbUser = snap.data() as User;
              if (dbUser) {
                // Update local user object with metadata from Firebase Auth
                dbUser.creationDate = new Date(user.metadata.creationTime);
                dbUser.lastSignInDate = new Date(user.metadata.lastSignInTime);
                (dbUser as any).isAnonymous = user.isAnonymous;
                // Fill missing settings using the now public helper
                dbUser.settings = this.userService.fillMissingAppSettings(dbUser);
                this.zone.run(() => {
                  runInInjectionContext(this.injector, () => {
                    observer.next(dbUser);
                  });
                });
              } else {
                this.zone.run(() => {
                  runInInjectionContext(this.injector, () => {
                    observer.next(null);
                  });
                });
              }
            }, error => observer.error(error));

            return () => unsubscribe();
          });
        } else {
          return of(null);
        }
      }),
      shareReplay(1)
    );
  }

  /*
   * Get the current user value (snapshot) from the observable
   */
  async getUser(): Promise<User | null> {
    return this.user$.pipe(take(1)).toPromise();
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
  private async signInWithProvider(provider: GoogleAuthProvider | GithubAuthProvider | FacebookAuthProvider | TwitterAuthProvider) {
    console.log('[Auth] signInWithProvider - localhost:', environment.localhost);
    try {
      if (environment.localhost) {
        console.log('[Auth] Using popup...');
        const result = await signInWithPopup(this.auth, provider);
        console.log('[Auth] Popup succeeded:', result);
        return result;
      } else {
        console.log('[Auth] Using redirect...');
        return signInWithRedirect(this.auth, provider);
      }
    } catch (error: any) {
      console.error('[Auth] signInWithProvider error:', error);
      console.error('[Auth] Error code:', error?.code);
      console.error('[Auth] Error message:', error?.message);
      throw error;
    }
  }

  async googleLogin() {
    const provider = new GoogleAuthProvider();
    return this.signInWithProvider(provider);
  }

  async githubLogin() {
    const provider = new GithubAuthProvider();
    return this.signInWithProvider(provider);
  }

  async facebookLogin() {
    const provider = new FacebookAuthProvider();
    return this.signInWithProvider(provider);
  }

  async twitterLogin() {
    const provider = new TwitterAuthProvider();
    return this.signInWithProvider(provider);
  }

  // Get the result after redirect-based sign in (production only)
  async getRedirectResult() {
    // Localhost uses popup, so no redirect result to process
    if (environment.localhost) {
      return null;
    }
    return getRedirectResult(this.auth);
  }

  //// Anonymous Auth ////

  async anonymousLogin() {
    try {
      return await signInAnonymously(this.auth);
    } catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  //// Email/Password Auth ////

  async emailSignUp(email: string, password: string) {
    try {
      return createUserWithEmailAndPassword(this.auth, email, password);
    } catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  async emailLogin(email: string, password: string) {
    try {
      return signInWithEmailAndPassword(this.auth, email, password);
    } catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  // Sends email allowing user to reset password
  async resetPassword(email: string) {
    try {
      await sendPasswordResetEmail(this.auth, email);
      this.snackBar.open(`Password update email sent`, null, {
        duration: 2000
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  async signOut(): Promise<void> {
    await signOut(this.auth);
    await terminate(this.firestore);
    this.localStorageService.clearAllStorage();
    return clearIndexedDbPersistence(this.firestore);
  }

  // If error, console log and notify user
  private handleError(error: Error) {
    console.error(error);
    this.snackBar.open(`Could not login due to error ${error.message}`, null, {
      duration: 2000
    });
  }
}
