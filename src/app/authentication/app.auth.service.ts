import { inject, Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, shareReplay, switchMap, take } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { AppUserService } from '../services/app.user.service';
import { AngularFireAnalytics } from '@angular/fire/compat/analytics';
import { LocalStorageService } from '../services/storage/app.local.storage.service';
import {
  Auth,
  authState,
  signInWithRedirect,
  signInAnonymously,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  GoogleAuthProvider,
  GithubAuthProvider,
  FacebookAuthProvider,
  TwitterAuthProvider,
  AuthProvider
} from '@angular/fire/auth';

@Injectable({
  providedIn: 'root'
})
export class AppAuthService {
  public user$: Observable<User | null>;
  // store the URL so we can redirect after logging in
  redirectUrl: string;

  private auth = inject(Auth);

  constructor(
    private afs: AngularFirestore,
    private afa: AngularFireAnalytics,
    private userService: AppUserService,
    private snackBar: MatSnackBar,
    private localStorageService: LocalStorageService
  ) {
    this.user$ = authState(this.auth).pipe(
      switchMap(user => {
        if (user) {
          return this.userService.getUserByID(user.uid).pipe(
            map((dbUser: User) => {
              if (dbUser) {
                // Update local user object with metadata from Firebase Auth
                dbUser.creationDate = new Date(user.metadata.creationTime);
                dbUser.lastSignInDate = new Date(user.metadata.lastSignInTime);
                (dbUser as any).isAnonymous = user.isAnonymous;
              }
              return dbUser;
            })
          );
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

  googleLoginWithRedirect() {
    const provider = new GoogleAuthProvider();
    return this.oAuthLoginWithRedirect(provider);
  }

  githubLoginWithRedirect() {
    const provider = new GithubAuthProvider();
    return this.oAuthLoginWithRedirect(provider);
  }

  facebookLoginWithRedirect() {
    const provider = new FacebookAuthProvider();
    return this.oAuthLoginWithRedirect(provider);
  }

  twitterLoginWithRedirect() {
    const provider = new TwitterAuthProvider();
    return this.oAuthLoginWithRedirect(provider);
  }

  private oAuthLoginWithRedirect(provider: AuthProvider) {
    try {
      return signInWithRedirect(this.auth, provider);
    } catch (e) {
      this.handleError(e);
      throw e;
    }
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
  resetPassword(email: string) {
    return sendPasswordResetEmail(this.auth, email)
      .then(() => this.snackBar.open(`Password update email sent`, null, {
        duration: 2000
      }))
      .catch(error => this.handleError(error));
  }

  async signOut(): Promise<void> {
    await signOut(this.auth);
    await this.afs.firestore.terminate();
    this.localStorageService.clearAllStorage();
    return this.afs.firestore.clearPersistence();
  }

  // If error, console log and notify user
  private handleError(error: Error) {
    console.error(error);
    this.snackBar.open(`Could not login due to error ${error.message}`, null, {
      duration: 2000
    });
  }
}
