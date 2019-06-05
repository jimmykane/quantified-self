import {Component, HostListener} from '@angular/core';
import {MatDialog} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {Router} from '@angular/router';
import {AppAuthService} from '../../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {take} from 'rxjs/operators';
import {UserService} from '../../services/app.user.service';
import {UserAgreementFormComponent} from '../user-forms/user-agreement.form.component';
import * as Raven from 'raven-js';
import {Log} from 'ng2-logger/browser';
import {AngularFireAuth} from '@angular/fire/auth';
import {ServiceTokenInterface} from 'quantified-self-lib/lib/service-tokens/service-token.interface';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent {

  isLoading: boolean;

  private logger = Log.create('LoginComponent');

  @HostListener('window:tokensReceived', ['$event'])
  async tokensReceived(event) {
    this.isLoading = true;
    const loggedInUser = await this.afAuth.auth.signInWithCustomToken(event.detail.firebaseAuthToken);
    this.redirectOrShowDataPrivacyDialog(loggedInUser, event.detail.serviceName, event.detail.serviceAuthResponse);
  }


  constructor(
    public authService: AppAuthService,
    private afAuth: AngularFireAuth,
    public userService: UserService,
    private router: Router,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
  ) {
  }

  async anonymousLogin() {
    try {
      return this.redirectOrShowDataPrivacyDialog(await this.authService.anonymousLogin());
    } catch (e) {
      Raven.captureException(e);
      this.logger.error(e);
      this.snackBar.open(`Could not log in due to ${e}`, null, {
        duration: 2000,
      });
    }
  }


  async googleLogin() {
    try {
      return this.redirectOrShowDataPrivacyDialog(await this.authService.googleLogin());
    } catch (e) {
      Raven.captureException(e);
      this.logger.error(e);
      this.snackBar.open(`Could not log in due to ${e}`, null, {
        duration: 2000,
      });
    }
  }

  async facebookLogin() {
    try {
      return this.redirectOrShowDataPrivacyDialog(await this.authService.facebookLogin());
    } catch (e) {
      Raven.captureException(e);
      this.logger.error(e);
      this.snackBar.open(`Could not log in due to ${e}`, null, {
        duration: 2000,
      });
    }
  }

  async suuntoAppLogin() {
    this.isLoading = true;
    // Open the popup that will start the auth flow.
    const wnd = window.open('assets/authPopup.html?signInWithService=true', 'name', 'height=585,width=400');
    if (!wnd || wnd.closed || typeof wnd.closed === 'undefined') {
      this.snackBar.open(`Popup has been block by your browser settings. Please disable popup blocking for this site to connect with the Suunto app`, null, {
        duration: 5000,
      });
      Raven.captureException(new Error(`Could not open popup for signing in with the Suunto app`));
    }
    wnd.onunload = () => this.isLoading = false;
  }

  async twitterLogin() {
    try {
      return this.redirectOrShowDataPrivacyDialog(await this.authService.twitterLogin());
    } catch (e) {
      Raven.captureException(e);
      this.logger.error(e);
      this.snackBar.open(`Could not log in due to ${e}`, null, {
        duration: 2000,
      });
    }
  }


  private async redirectOrShowDataPrivacyDialog(loginServiceUser, serviceName?: string, serviceToken?: ServiceTokenInterface) {
    this.isLoading = true;
    try {
      const databaseUser = await this.userService.getUserByID(loginServiceUser.user.uid).pipe(take(1)).toPromise();
      if (databaseUser) {
        if (serviceName && serviceToken) {
          await this.userService.setServiceAuthToken(databaseUser, serviceName, serviceToken)
        }
        await this.router.navigate(['/dashboard']);
        this.snackBar.open(`Welcome back ${databaseUser.displayName || 'Anonymous'}`, null, {
          duration: 2000,
        });
        return;
      }
      this.showUserAgreementFormDialog(new User(loginServiceUser.user.uid, loginServiceUser.user.displayName, loginServiceUser.user.photoURL), serviceName, serviceToken)
    } catch (e) {
      Raven.captureException(e);
      this.isLoading = false;
    }
  }

  private showUserAgreementFormDialog(user: User, serviceName?: string, serviceToken?: ServiceTokenInterface) {
    const dialogRef = this.dialog.open(UserAgreementFormComponent, {
      width: '75vw',
      disableClose: true,
      data: {
        user: user,
        serviceName: serviceName,
        serviceToken: serviceToken
      },
    });

    dialogRef.afterClosed().subscribe(result => {
      this.isLoading = false;
    });
  }

  @HostListener('window:resize', ['$event'])
  getColumnsToDisplayDependingOnScreenSize(event?) {
    return window.innerWidth < 600 ? 1 : 2;
  }

}
