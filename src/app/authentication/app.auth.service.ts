import {Injectable, OnDestroy} from '@angular/core';

import {auth} from 'firebase/app';
import {User as FireBaseUser} from 'firebase/app';

import {Observable, of, Subscription} from 'rxjs';
import {map, switchMap, take} from 'rxjs/operators';
import {MatSnackBar} from '@angular/material';
import {AngularFireAuth} from '@angular/fire/auth';
import {AngularFirestore, AngularFirestoreDocument} from '@angular/fire/firestore';
import {User} from 'quantified-self-lib/lib/users/user';
import {UserService} from '../services/app.user.service';

@Injectable()
export class AppAuthService implements OnDestroy {
  user: Observable<User | null>;
  private authState = false;
  userSubscription: Subscription;

  constructor(
    private afAuth: AngularFireAuth,
    private afs: AngularFirestore,
    private userService: UserService,
    private snackBar: MatSnackBar,
  ) {
    this.user = this.afAuth.authState.pipe(
      switchMap(user => {
        if (user) {
          return this.afs.doc<User>(`users/${user.uid}`).valueChanges().pipe(map((dbUser: User) => {
            if (dbUser) {
              this.authState = true;
            }else {
              this.authState = false;
            }
            return dbUser;
          }));
        } else {
          this.authState = false;
          return of(null);
        }
      }),
    );
    this.userSubscription = this.user.subscribe(); // Todo kill
  }

  authenticated(): boolean {
    return this.authState;
  }

  async googleLogin(): Promise<auth.UserCredential> {
    const provider = new auth.GoogleAuthProvider();
    return this.oAuthLogin(provider);
  }

  async githubLogin(): Promise<auth.UserCredential> {
    const provider = new auth.GithubAuthProvider();
    return this.oAuthLogin(provider);
  }

  async facebookLogin(): Promise<auth.UserCredential> {
    const provider = new auth.FacebookAuthProvider();
    return this.oAuthLogin(provider);
  }

  async twitterLogin(): Promise<auth.UserCredential> {
    const provider = new auth.TwitterAuthProvider();
    return this.oAuthLogin(provider);
  }

  private async oAuthLogin(provider: any) {
    try {
      return this.afAuth.auth.signInWithPopup(provider);
    } catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  //// Anonymous Auth ////

  async anonymousLogin() {
    try {
      return this.afAuth.auth.signInAnonymously();
    } catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  //// Email/Password Auth ////

  async emailSignUp(email: string, password: string) {
    try {
      return this.afAuth.auth.createUserWithEmailAndPassword(email, password);
    } catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  async emailLogin(email: string, password: string) {
    try {
      return this.afAuth.auth.signInWithEmailAndPassword(email, password);
    } catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  // Sends email allowing user to reset password
  resetPassword(email: string) {
    const fbAuth = auth();
    return fbAuth
      .sendPasswordResetEmail(email)
      .then(() => this.snackBar.open(`Password update email sent`, null, {
        duration: 2000,
      }))
      .catch(error => this.handleError(error));
  }

  signOut(): Promise<void> {
    return this.afAuth.auth.signOut();
  }

  private async getOrInsertUser(user: User) {
    // Check if we have a user
    const databaseUser = await this.userService.getUserByID(user.uid).pipe(take(1)).toPromise();
    if (!databaseUser) {
      return this.userService.createOrUpdateUser(new User(user.uid, user.displayName, user.photoURL));
    }
    return Promise.resolve(databaseUser);
  }

  // If error, console log and notify user
  private handleError(error: Error) {
    console.error(error);
    this.snackBar.open(`Could not login due to error ${error.message}`, null, {
      duration: 2000,
    });
  }

  ngOnDestroy(): void {
    this.userSubscription.unsubscribe();
  }
}
