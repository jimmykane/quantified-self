import { Component, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { AppAuthService } from '../../authentication/app.auth.service';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { take } from 'rxjs/operators';
import { AppUserService } from '../../services/app.user.service';
import { UserAgreementFormComponent } from '../user-forms/user-agreement.form.component';
import * as Sentry from '@sentry/browser';

import { Auth, getRedirectResult, signInWithCustomToken } from '@angular/fire/auth';
import { PhoneFormComponent } from './phone-form/phone.form.component';
import { Analytics, logEvent } from '@angular/fire/analytics';
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib/lib/service-tokens/oauth2-service-token.interface';
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
    this.userSubscription = this.authService.user$.subscribe((user) => {
      if (user) {
        this.router.navigate(['/dashboard']);
      }
    });

    try {
      const result = await getRedirectResult(this.auth);
      if (result && result.user) {
        await this.redirectOrShowDataPrivacyDialog(result);
      }
    } catch (e) {
      Sentry.captureException(e);

      this.snackBar.open(`Could not log in due to ${e} `, undefined, {
        duration: 2000,
      });
    } finally {
      this.isLoading = false;
    }
  }


  async signInWithProvider(provider: SignInProviders) {
    this.isLoading = true;
    try {
      switch (provider) {
        case SignInProviders.Anonymous:
          await this.redirectOrShowDataPrivacyDialog(await this.authService.anonymousLogin());
          break;
        case SignInProviders.Google:
          await this.authService.googleLoginWithRedirect();
          break;
        case SignInProviders.Facebook:
          await this.authService.facebookLoginWithRedirect();
          break;
        case SignInProviders.Twitter:
          await this.authService.twitterLoginWithRedirect();
          break;
        case SignInProviders.GitHub:
          await this.authService.githubLoginWithRedirect();
          break;
        case SignInProviders.PhoneNumber:
          this.showPhoneNumberForm();
          break;
      }
    } catch (e) {
      Sentry.captureException(e);

      this.snackBar.open(`Could not log in due to ${e} `, undefined, {
        duration: 2000,
      });
    }
    this.isLoading = false;
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
