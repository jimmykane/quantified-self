import {Injectable, OnDestroy} from '@angular/core';

import {auth} from 'firebase/app';
import {User as FireBaseUser} from 'firebase/app';

import {Observable, of, Subscription} from 'rxjs';
import {switchMap} from 'rxjs/operators';
import {MatSnackBar} from '@angular/material';
import {AngularFireAuth} from '@angular/fire/auth';
import {AngularFirestore, AngularFirestoreDocument} from '@angular/fire/firestore';
import {User} from 'quantified-self-lib/lib/users/user';

@Injectable()
export class AppAuthService implements OnDestroy{
  user: Observable<User | null>;
  private authState = false;
  userSubscription: Subscription;

  constructor(
    private afAuth: AngularFireAuth,
    private afs: AngularFirestore,
    private snackBar: MatSnackBar,
  ) {
    this.user = this.afAuth.authState.pipe(
      switchMap(user => {
        if (user) {
          this.authState = true;
          return this.afs.doc<User>(`users/${user.uid}`).valueChanges();
        } else {
          this.authState = false;
          return of(null);
        }
      }),
    );
    this.userSubscription = this.user.subscribe();
  }

  authenticated(): boolean {
    return this.authState;
  }

  async googleLogin() {
    const provider = new auth.GoogleAuthProvider();
    return this.oAuthLogin(provider);
  }

  async githubLogin() {
    const provider = new auth.GithubAuthProvider();
    return this.oAuthLogin(provider);
  }

  async facebookLogin() {
    const provider = new auth.FacebookAuthProvider();
    return this.oAuthLogin(provider);
  }

  async twitterLogin() {
    const provider = new auth.TwitterAuthProvider();
    return this.oAuthLogin(provider);
  }

  private async oAuthLogin(provider: any) {
     try {
      const credential = await this.afAuth.auth.signInWithPopup(provider);
      return this.updateUserData(credential.user);
    }catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  //// Anonymous Auth ////

  async anonymousLogin() {
    try {
      const credential = await this.afAuth.auth.signInAnonymously();
      return this.updateUserData(credential.user);
    }catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  //// Email/Password Auth ////

  async emailSignUp(email: string, password: string) {
      try {
      const credential = await this.afAuth.auth.createUserWithEmailAndPassword(email, password);
      return this.updateUserData(credential.user);
    }catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  emailLogin(email: string, password: string) {
    return this.afAuth.auth
      .signInWithEmailAndPassword(email, password)
      .then(credential => {
        this.snackBar.open(`Welcome back`, null, {
          duration: 5000,
        });
        return this.updateUserData(credential.user);
      })
      .catch(error => this.handleError(error));
  }

  // Sends email allowing user to reset password
  resetPassword(email: string) {
    const fbAuth = auth();
    return fbAuth
      .sendPasswordResetEmail(email)
      .then(() => this.snackBar.open(`Password update email sent`, null, {
        duration: 5000,
      }))
      .catch(error => this.handleError(error));
  }

  signOut(): Promise<void> {
    return this.afAuth.auth.signOut();
  }

  // If error, console log and notify user
  private handleError(error: Error) {
    console.error(error);
    this.snackBar.open(`Could not login due to error ${error.message}`, null, {
      duration: 5000,
    });
  }

  // Sets user data to firestore after succesful login
  private async updateUserData(user: User | FireBaseUser) {
    const userRef: AngularFirestoreDocument<User> = this.afs.doc(
      `users/${user.uid}`,
    );
    user = new User(user.uid, user.email, user.displayName, user.photoURL);
    await userRef.set(user.toJSON());
    return Promise.resolve(user);
  }

  ngOnDestroy(): void {
    this.userSubscription.unsubscribe();
  }
}
