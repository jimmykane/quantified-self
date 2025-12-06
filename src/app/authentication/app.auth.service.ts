import { Injectable, OnDestroy } from '@angular/core';
import { Observable, of, Subscription } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { AppUserService } from '../services/app.user.service';
import { AngularFireAnalytics } from '@angular/fire/compat/analytics';
import { LocalStorageService } from '../services/storage/app.local.storage.service';
import { FirebaseApp } from '@angular/fire/compat';
import {
  getAuth,
  signInWithPopup,
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  GithubAuthProvider,
  FacebookAuthProvider,
  TwitterAuthProvider,
  Auth,
  browserLocalPersistence,
  setPersistence,
  browserPopupRedirectResolver
} from 'firebase/auth';


@Injectable({
  providedIn: 'root'
})
export class AppAuthService implements OnDestroy {
  user: Observable<User | null>;
  redirectUrl: string;
  private authState = null;
  private guest: boolean;
  private userSubscription: Subscription;
  private _auth: Auth | null = null;

  constructor(
    private afAuth: AngularFireAuth, // Keep for authState observation only
    private firebaseApp: FirebaseApp, // Inject AngularFire's FirebaseApp
    private afs: AngularFirestore,
    private afa: AngularFireAnalytics,
    private userService: AppUserService,
    private snackBar: MatSnackBar,
    private localStorageService: LocalStorageService
  ) {
    // Use AngularFireAuth only for state observation (it works for that)
    this.user = this.afAuth.authState.pipe(
      switchMap(user => {
        if (user) {
          this.guest = user.isAnonymous;
          return this.userService.getUserByID(user.uid).pipe(map((dbUser: User) => {
            this.authState = !!dbUser;
            if (dbUser) {
              dbUser.creationDate = new Date(user.metadata.creationTime);
              dbUser.lastSignInDate = new Date(user.metadata.lastSignInTime);
            }
            return dbUser;
          }));
        } else {
          this.authState = false;
          return of(null);
        }
      })
    );
  }

  authenticated(): boolean {
    return this.authState;
  }

  isGuest(): boolean {
    return !!this.guest;
  }

  private get auth(): Auth {
    if (!this._auth) {
      // AngularFire Compat wraps the Modular app in _delegate
      const modularApp = (this.firebaseApp as any)._delegate || this.firebaseApp;
      this._auth = getAuth(modularApp);
      console.log('[AppAuthService] Lazily initialized Modular Auth from FirebaseApp._delegate:', this._auth);
    }
    return this._auth;
  }

  // Using pure Modular SDK signInWithPopup - bypassing AngularFireAuth entirely
  googleLoginWithRedirect() {
    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    return this.oAuthLoginWithPopup(provider);
  }

  githubLoginWithRedirect() {
    const provider = new GithubAuthProvider();
    return this.oAuthLoginWithPopup(provider);
  }

  facebookLoginWithRedirect() {
    const provider = new FacebookAuthProvider();
    return this.oAuthLoginWithPopup(provider);
  }

  twitterLoginWithRedirect() {
    const provider = new TwitterAuthProvider();
    return this.oAuthLoginWithPopup(provider);
  }

  gitHubLoginWithRedirect() {
    const provider = new GithubAuthProvider();
    return this.oAuthLoginWithPopup(provider);
  }

  async oAuthLoginWithPopup(provider: GoogleAuthProvider | GithubAuthProvider | FacebookAuthProvider | TwitterAuthProvider) {
    try {
      console.log('[AppAuthService] Setting persistence and calling signInWithPopup', { provider });
      // Set persistence to local to ensure state retention
      await setPersistence(this.auth, browserLocalPersistence);

      // Use browserPopupRedirectResolver to handle cross-origin popup reliability
      const result = await signInWithPopup(this.auth, provider, browserPopupRedirectResolver);
      console.log('[AppAuthService] signInWithPopup result:', result);
      return result;
    } catch (e) {
      console.error('[AppAuthService] Error in oAuthLoginWithPopup', e);
      this.handleError(e);
      throw e;
    }
  }

  async getRedirectResult() {
    return null;
  }

  async anonymousLogin() {
    try {
      return await signInAnonymously(this.auth);
    } catch (e) {
      this.handleError(e);
      throw e;
    }
  }

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
    }
  }

  resetPassword(email: string) {
    return sendPasswordResetEmail(this.auth, email)
      .then(() => this.snackBar.open(`Password update email sent`, null, {
        duration: 2000
      }))
      .catch(error => this.handleError(error));
  }

  async signOut(): Promise<void> {
    await this.afAuth.signOut();
    await this.afs.firestore.terminate();
    this.localStorageService.clearAllStorage();
    return this.afs.firestore.clearPersistence();
  }

  ngOnDestroy(): void {
    this.userSubscription.unsubscribe();
  }

  private async getOrInsertUser(user: User) {
    const databaseUser = await this.userService.getUserByID(user.uid).pipe(take(1)).toPromise();
    if (!databaseUser) {
      return this.userService.createOrUpdateUser(new User(user.uid, user.displayName, user.photoURL));
    }
    return Promise.resolve(databaseUser);
  }

  private handleError(error: any) {
    console.error('[AppAuthService] Error:', error);
    this.snackBar.open(`Could not login due to error ${error.message}`, null, {
      duration: 5000
    });
  }
}
