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
import { LoggerService } from '../../services/logger.service';
import { AccountLinkingDialogComponent } from './account-linking-dialog/account-linking-dialog.component';
import { ErrorDialogComponent } from './error-dialog/error-dialog.component';



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
    private logger: LoggerService
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
          .then(async (result) => {
            // Check for pending link intent (Scenario: User clicked "Send Magic Link" to link this email to an existing GitHub/Google account)
            // Wait, logic is reverse: User was on "Login" page, tried to sign in with GitHub, failed (collision), chose "Send Magic Link".
            // So now they are signed in with Email. We need to link GitHub.
            const pendingLinkProvider = this.authService.localStorageService.getItem('pendingLinkProvider');
            if (pendingLinkProvider) {
              this.isLoading = false;
              const confirmLink = window.confirm(
                `You are now signed in with your email. Please sign in with ${pendingLinkProvider} to finish linking your accounts.`
              );

              if (confirmLink) {
                this.authService.localStorageService.removeItem('pendingLinkProvider');
                await this.linkPendingProvider(pendingLinkProvider, result.user);
                return; // linkPendingProvider handles redirect/dialog
              }
            }
            this.redirectOrShowDataPrivacyDialog(result);
          })
          .catch((error) => {
            this.isLoading = false;
            // Handle collision (Scenario: User tries to sign in with Email Link, but account exists with GitHub)
            if (error.code === 'auth/credential-already-in-use' || error.code === 'auth/account-exists-with-different-credential' || error.code === 'auth/email-already-in-use') {
              // For email link, the email is known.
              // We need to trigger the collision flow.
              // However, error object might not provide everything cleanly for email link flow.
              // But we have the 'email' variable.
              // We can manually trigger the resolution.
              this.handleAccountCollision(error, email);
              return;
            }

            this.logger.error('Error signing in with email link', error);
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
            this.logger.warn('Login: Firebase authenticated, but no DB profile. Triggering registration flow.');
            this.redirectOrShowDataPrivacyDialog({ user: firebaseUser });
          }
        }, 500);
      }
    });

    this.isLoading = false;
  }

  // .. existing sendEmailLink ...

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
      if (e.code === 'auth/account-exists-with-different-credential' || e.code === 'auth/credential-already-in-use') {
        await this.handleAccountCollision(e);
        return;
      }

      Sentry.captureException(e);
      this.showErrorDialog('Login Failed', e);
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

  // Refactored collision handling
  private async handleAccountCollision(error: any, emailHint?: string) {
    const email = error.customData?.email || emailHint;
    const pendingCredential = OAuthProvider.credentialFromError(error); // Might be null if it was email link login that failed

    if (email) {
      try {
        const methods = await this.authService.fetchSignInMethods(email);
        if (methods.length > 0) {
          // "pendingProvider" is needed for the dialog text: "to link your new [pendingProvider] login".
          // If we have pendingCredential, use its providerId.
          // If not (e.g. failed Email Link login), we know the user was *trying* Email Link.
          const pendingProviderId = pendingCredential ? pendingCredential.providerId : 'emailLink';

          const dialogRef = this.dialog.open(AccountLinkingDialogComponent, {
            data: {
              email: email,
              existingProviders: methods, // Pass ALL existing methods
              pendingProvider: pendingProviderId
            },
            maxWidth: '500px',
            autoFocus: false
          });

          const selectedProvider = await dialogRef.afterClosed().toPromise();

          if (selectedProvider) {
            if (selectedProvider === 'emailLink') {
              // User wants to link using Email Link (Send Magic Link)
              // This means we need to "park" the pending credential (if any) or just the intent.
              // 1. Send Link
              await this.sendEmailLink(email);
              // 2. Save intent. We want to link the *original* pending credential (e.g. GitHub) 
              // to the account that will be signed in via email.
              if (pendingCredential) {
                // We can't save the full credential object :(
                // But we can save the provider ID and ask user to re-login with it to link.
                this.authService.localStorageService.setItem('pendingLinkProvider', pendingCredential.providerId);
              }
              // If there was NO pending credential (e.g. reverse case: Email Link failed, user chose to sign in with GitHub?),
              // Wait, if selectedProvider is 'emailLink', it implies the user wants to use Email Link to VERIFY ownership.
              // This path is usually: User tried GitHub -> Collided -> Chose "Send Magic Link".
            } else {
              // User chose an existing OAuth provider (e.g. Google) to sign in and link.
              const provider = this.authService.getProviderForId(selectedProvider);
              if (!provider) return;

              const result = await signInWithPopup(this.auth, provider as any);
              if (result.user) {
                // If we have a pending credential (e.g. GitHub), link it now.
                if (pendingCredential) {
                  await this.authService.linkCredential(result.user, pendingCredential);
                  this.snackBar.open('Accounts successfully linked!', 'Close', { duration: 5000 });
                }
                // If we didn't have a pending credential (e.g. reverse case), we just logged them in.
                // But usually we want to link the *failed* method.
                // If 'signinWithEmailLink' failed, we don't have a 'credential' object to link easily 
                // unless we ask them to click the link *again*? 
                // Actually, for "Reverse": User triggers Email Link -> Fails -> User logs in with Google.
                // User is now logged in. The Email Link is "lost" unless they click it again? 
                // Or do we say "You are logged in. To add email link sign-in, go to settings"?
                // For now, simple login is good enough for the 'base' account retrieval.
                return this.redirectOrShowDataPrivacyDialog(result);
              }
            }
          }
        }
      } catch (linkError: any) {
        this.logger.error('Account linking failed:', linkError);
        this.showErrorDialog('Account Linking Failed', linkError);
      }
    }
    this.isLoading = false;
  }

  private showErrorDialog(title: string, error: any) {
    const message = this.mapErrorMessage(error);
    this.dialog.open(ErrorDialogComponent, {
      data: { title, message },
      width: '400px'
    });
  }

  private mapErrorMessage(error: any): string {
    const code = error.code || error.message;
    switch (code) {
      case 'auth/credential-already-in-use':
        return 'This account is already linked to another user. Please sign in with the original account.';
      case 'auth/invalid-credential':
        return 'The credential causing the conflict is invalid or expired. Please try signing in again.';
      case 'auth/network-request-failed':
        return 'Network connection failed. Please check your internet connection and try again.';
      case 'auth/popup-closed-by-user':
        return 'The sign-in popup was closed before completing the process. Please try again.';
      default:
        return error.message || 'We could not link your accounts. Please try again or contact support.';
    }
  }

  // Helper to link a provider after secondary login (Persistence flow)
  private async linkPendingProvider(providerId: string, user: any) {
    try {
      const provider = this.authService.getProviderForId(providerId);
      // We need to re-authenticate/link. 
      // `linkWithPopup` will open the provider popup and link it to the 'user'.
      await this.authService.linkWithPopup(user, provider as any);
      this.snackBar.open('Accounts successfully linked!', 'Close', { duration: 5000 });
      this.router.navigate(['/dashboard']);
    } catch (e: any) {
      this.logger.error('Link pending provider failed', e);
      this.showErrorDialog('Account Linking Failed', e);
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
