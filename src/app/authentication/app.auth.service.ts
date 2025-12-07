import { inject, Injectable, EnvironmentInjector, runInInjectionContext, NgZone } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, shareReplay, switchMap, take } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Firestore, doc, onSnapshot } from '@angular/fire/firestore';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { AppUserService } from '../services/app.user.service';
import { AngularFireAnalytics } from '@angular/fire/compat/analytics';
import { LocalStorageService } from '../services/storage/app.local.storage.service';
import {
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
  AuthProvider,
  getAuth
} from 'firebase/auth';

@Injectable({
  providedIn: 'root'
})
export class AppAuthService {
  public user$: Observable<User | null>;
  // store the URL so we can redirect after logging in
  redirectUrl: string;

  private firestore = inject(Firestore);
  private injector = inject(EnvironmentInjector);
  private zone = inject(NgZone);

  constructor(
    private afAuth: AngularFireAuth,
    private afs: AngularFirestore,
    private afa: AngularFireAnalytics,
    private userService: AppUserService,
    private snackBar: MatSnackBar,
    private localStorageService: LocalStorageService
  ) {
    // Use compat AngularFireAuth.authState to stay in injection context
    this.user$ = this.afAuth.authState.pipe(
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
  private async getAuthInstance() {
    await this.afAuth.authState.pipe(take(1)).toPromise();
    return getAuth();
  }

  async googleLoginWithRedirect() {
    const auth = await this.getAuthInstance();
    const provider = new GoogleAuthProvider();
    return signInWithRedirect(auth, provider);
  }

  async githubLoginWithRedirect() {
    const auth = await this.getAuthInstance();
    const provider = new GithubAuthProvider();
    return signInWithRedirect(auth, provider);
  }

  async facebookLoginWithRedirect() {
    const auth = await this.getAuthInstance();
    const provider = new FacebookAuthProvider();
    return signInWithRedirect(auth, provider);
  }

  async twitterLoginWithRedirect() {
    const auth = await this.getAuthInstance();
    const provider = new TwitterAuthProvider();
    return signInWithRedirect(auth, provider);
  }

  //// Anonymous Auth ////

  async anonymousLogin() {
    try {
      const auth = await this.getAuthInstance();
      return await signInAnonymously(auth);
    } catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  //// Email/Password Auth ////

  async emailSignUp(email: string, password: string) {
    try {
      const auth = await this.getAuthInstance();
      return createUserWithEmailAndPassword(auth, email, password);
    } catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  async emailLogin(email: string, password: string) {
    try {
      const auth = await this.getAuthInstance();
      return signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  // Sends email allowing user to reset password
  async resetPassword(email: string) {
    try {
      const auth = await this.getAuthInstance();
      await sendPasswordResetEmail(auth, email);
      this.snackBar.open(`Password update email sent`, null, {
        duration: 2000
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  async signOut(): Promise<void> {
    const auth = await this.getAuthInstance();
    await signOut(auth);
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
