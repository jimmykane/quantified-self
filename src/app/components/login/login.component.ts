import { Component, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { AppAuthService } from '../../authentication/app.auth.service';
import { User } from '@sports-alliance/sports-lib';
import { take } from 'rxjs/operators';
import { AppUserService } from '../../services/app.user.service';
import * as Sentry from '@sentry/browser';
import { Auth, signInWithCustomToken, authState, OAuthProvider, signInWithPopup } from '@angular/fire/auth';
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

  isLoading: boolean = false;
  signInProviders = SignInProviders;
  email: string = '';
  private userSubscription: Subscription | undefined;
  private auth = inject(Auth);
  private analytics = inject(Analytics);


  @HostListener('window:tokensReceived', ['$event'])
  async tokensReceived(event: any) {
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

    // Check for email link sign-in
    if (this.authService.isSignInWithEmailLink(window.location.href)) {
      let email = this.authService.localStorageService.getItem('emailForSignIn');
      if (!email) {
        // User opened the link on a different device. To prevent session fixation, ask the user to provide the associated email again.
        email = window.prompt('Please provide your email for confirmation') || '';
      }

      if (email) {
        this.isLoading = true;
        this.authService.signInWithEmailLink(email, window.location.href)
          .then((result) => {
            this.redirectOrShowDataPrivacyDialog(result);
          })
          .catch((error) => {
            this.isLoading = false;
            console.error('Error signing in with email link', error);
            this.snackBar.open('Error signing in. The link might be invalid or expired.', 'Close');
          });
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


  async sendEmailLink(email: string) {
    if (!email) {
      this.snackBar.open('Please enter a valid email address.', 'Close', { duration: 3000 });
      return;
    }
    this.isLoading = true;
    const success = await this.authService.sendEmailLink(email);
    this.isLoading = false;
    if (success) {
      this.snackBar.open('Magic link sent! Check your inbox.', 'Close', { duration: 5000 });
    }
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
    const handleError = async (e: any) => {
      if (e.code === 'auth/account-exists-with-different-credential') {
        const email = e.customData?.email;
        const pendingCredential = OAuthProvider.credentialFromError(e);

        if (email && pendingCredential) {
          try {
            const methods = await this.authService.fetchSignInMethods(email);
            if (methods.length > 0) {
              const providerId = methods[0]; // Usually the first one is what we want
              const providerName = providerId.split('.')[0]; // simple name like 'google' or 'github'

              const confirmLink = window.confirm(
                `An account already exists with the email ${email} using ${providerName}. ` +
                `Would you like to sign in with ${providerName} to link your accounts?`
              );

              if (confirmLink) {
                const provider = this.authService.getProviderForId(providerId);
                const result = await signInWithPopup(this.auth, provider as any);
                if (result.user) {
                  await this.authService.linkCredential(result.user, pendingCredential);
                  this.snackBar.open('Accounts successfully linked!', 'Close', { duration: 5000 });
                  return handleResult(result);
                }
              }
            }
          } catch (linkError: any) {
            console.error('Account linking failed:', linkError);
            this.snackBar.open(`Account linking failed: ${linkError.message}`, 'Close');
          }
        }
      }

      Sentry.captureException(e);
      this.snackBar.open(`Could not log in due to ${e.message || e} `, undefined, {
        duration: 5000,
      });
      this.isLoading = false;
    };

    switch (provider) {
      case SignInProviders.Google:
        // Call synchronously (no await before popup) to avoid Safari blocking
        this.authService.googleLogin()
          .then(handleResult)
          .catch(handleError);
        break;
      case SignInProviders.GitHub:
        this.authService.githubLogin()
          .then(handleResult)
          .catch(handleError);
        break;
    }
  }

  private async redirectOrShowDataPrivacyDialog(loginServiceUser: any) {
    this.isLoading = true;
    try {
      const databaseUser = await this.userService.getUserByID(loginServiceUser.user.uid).pipe(take(1)).toPromise();
      logEvent(this.analytics, 'login', { method: loginServiceUser.credential ? loginServiceUser.credential.signInMethod : 'Guest' });
      await this.router.navigate(['/dashboard']);
      this.snackBar.open(`Welcome back ${databaseUser?.displayName || 'Guest'} `, undefined, {
        duration: 5000,
      });
    } catch (e) {
      Sentry.captureException(e);
      this.isLoading = false;
    }
  }



  @HostListener('window:resize', ['$event'])
  getColumnsToDisplayDependingOnScreenSize(event?: any) {
    return window.innerWidth < 600 ? 1 : window.innerWidth < 900 ? 2 : 3;
  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }

}


export enum SignInProviders {
  Google,
  GitHub,
  Email
}
