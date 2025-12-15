import { Component, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { AppAuthService } from '../../authentication/app.auth.service';
import { User } from '@sports-alliance/sports-lib';
import { take } from 'rxjs/operators';
import { AppUserService } from '../../services/app.user.service';
import { UserAgreementFormComponent } from '../user-forms/user-agreement.form.component';
import * as Sentry from '@sentry/browser';

import { Auth, signInWithCustomToken, authState } from '@angular/fire/auth';
import { PhoneFormComponent } from './phone-form/phone.form.component';
import { Analytics, logEvent } from '@angular/fire/analytics';
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { Subscription } from 'rxjs';


@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
  standalone: false
})
export class LoginComponent implements OnInit, OnDestroy {

  isLoading: boolean;
  signInProviders = SignInProviders;
  private userSubscription: Subscription;
  private auth = inject(Auth);
  private analytics = inject(Analytics);


  @HostListener('window:tokensReceived', ['$event'])
  async tokensReceived(event) {
    this.isLoading = true;
    const loggedInUser = await signInWithCustomToken(this.auth, event.detail.firebaseAuthToken);
    return this.redirectOrShowDataPrivacyDialog(loggedInUser);
  }


  constructor(
    public authService: AppAuthService,
    public userService: AppUserService,
    private router: Router,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
  ) {
  }

  async ngOnInit() {
    this.isLoading = true;

    // Handle redirect result from OAuth providers
    console.log('[Auth Debug] ngOnInit - checking for redirect result...');
    try {
      const redirectResult = await this.authService.getRedirectResult();
      console.log('[Auth Debug] getRedirectResult returned:', redirectResult);
      if (redirectResult && redirectResult.user) {
        console.log('[Auth Debug] Redirect result has user, processing...');
        await this.redirectOrShowDataPrivacyDialog(redirectResult);
        return;
      } else {
        console.log('[Auth Debug] No redirect result or no user in result');
      }
    } catch (e: any) {
      console.error('[Auth Debug] getRedirectResult error:', e);
      // Ignore "missing initial state" error - this happens when:
      // 1. Switching from redirect to popup auth (old pending redirect)
      // 2. Storage partitioning in cross-origin scenario
      if (e?.code !== 'auth/missing-initial-state') {
        console.error('Redirect result error:', e);
        Sentry.captureException(e);
      }
    }

    this.userSubscription = this.authService.user$.subscribe((user) => {
      if (user) {
        this.router.navigate(['/dashboard']);
      }
    });

    // Check if user is already authenticated with Firebase but has no DB profile
    authState(this.auth).pipe(take(1)).subscribe(async (firebaseUser) => {
      if (firebaseUser) {
        setTimeout(async () => {
          const dbUser = await this.authService.getUser();
          if (!dbUser) {
            console.warn('Login: Firebase authenticated, but no DB profile. Triggering registration flow.');
            this.redirectOrShowDataPrivacyDialog({ user: firebaseUser });
          }
        }, 500);
      }
    });

    this.isLoading = false;
  }


  signInWithProvider(provider: SignInProviders) {
    this.isLoading = true;

    // Helper to handle login result
    const handleResult = async (result: any) => {
      if (result) {
        await this.redirectOrShowDataPrivacyDialog(result);
      }
      this.isLoading = false;
    };

    // Helper to handle errors
    const handleError = (e: any) => {
      Sentry.captureException(e);
      this.snackBar.open(`Could not log in due to ${e} `, undefined, {
        duration: 2000,
      });
      this.isLoading = false;
    };

    switch (provider) {
      case SignInProviders.Anonymous:
        this.authService.anonymousLogin()
          .then(handleResult)
          .catch(handleError);
        break;
      case SignInProviders.Google:
        // Call synchronously (no await before popup) to avoid Safari blocking
        this.authService.googleLogin()
          .then(handleResult)
          .catch(handleError);
        break;
      case SignInProviders.Facebook:
        this.authService.facebookLogin()
          .then(handleResult)
          .catch(handleError);
        break;
      case SignInProviders.Twitter:
        this.authService.twitterLogin()
          .then(handleResult)
          .catch(handleError);
        break;
      case SignInProviders.GitHub:
        this.authService.githubLogin()
          .then(handleResult)
          .catch(handleError);
        break;
      case SignInProviders.PhoneNumber:
        this.showPhoneNumberForm();
        break;
    }
  }

  private async redirectOrShowDataPrivacyDialog(loginServiceUser) {
    this.isLoading = true;
    try {
      const databaseUser = await this.userService.getUserByID(loginServiceUser.user.uid).pipe(take(1)).toPromise();
      if (databaseUser) {
        logEvent(this.analytics, 'login', { method: loginServiceUser.credential ? loginServiceUser.credential.signInMethod : 'Guest' });
        await this.router.navigate(['/dashboard']);
        this.snackBar.open(`Welcome back ${databaseUser.displayName || 'Guest'} `, undefined, {
          duration: 5000,
        });
        return;
      }
      this.showUserAgreementFormDialog(new User(loginServiceUser.user.uid, loginServiceUser.user.displayName, loginServiceUser.user.photoURL), loginServiceUser.credential ? loginServiceUser.credential.signInMethod : 'Anonymous')
    } catch (e) {
      Sentry.captureException(e);
      this.isLoading = false;
    }
  }

  private showUserAgreementFormDialog(user: User, signInMethod: string) {
    const dialogRef = this.dialog.open(UserAgreementFormComponent, {
      minWidth: '80vw',
      disableClose: true,
      data: {
        user: user,
        signInMethod: signInMethod,
      },
    });

    dialogRef.afterClosed().subscribe(result => {
      this.isLoading = false;
    });
  }

  @HostListener('window:resize', ['$event'])
  getColumnsToDisplayDependingOnScreenSize(event?) {
    return window.innerWidth < 600 ? 1 : window.innerWidth < 900 ? 2 : 3;
  }

  private showPhoneNumberForm() {
    const dialogRef = this.dialog.open(PhoneFormComponent, {
      width: '86vw',
      maxWidth: '86vw',
      disableClose: false,
      data: {},
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && result.user) {
        this.redirectOrShowDataPrivacyDialog(result.user)
      }
      this.isLoading = false;
    });
  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }

}


export enum SignInProviders {
  Anonymous,
  Google,
  Facebook,
  Twitter,
  SuuntoApp,
  GitHub,
  PhoneNumber,
}
