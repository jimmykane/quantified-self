import {Component} from '@angular/core';
import {MatDialog, MatSnackBar} from '@angular/material';
import {Router} from '@angular/router';
import {AppAuthService} from '../../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {take} from 'rxjs/operators';
import {UserService} from '../../services/app.user.service';
import {UserFormComponent} from '../user-forms/user.form.component';
import {UserAgreementFormComponent} from '../user-forms/user-agreement.form.component';
import * as Raven from "raven-js";

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent {

  isLoggingIn: boolean;

  constructor(
    public authService: AppAuthService,
    public userService: UserService,
    private router: Router,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
  ) {
  }

  async anonymousLogin() {
    return this.redirectOrShowDataPrivacyDialog(await this.authService.anonymousLogin());
  }


  async googleLogin() {
    return this.redirectOrShowDataPrivacyDialog(await this.authService.googleLogin());
  }


  private async redirectOrShowDataPrivacyDialog(loginServiceUser) {
    this.isLoggingIn = true;
    try {
      const databaseUser = await this.userService.getUserByID(loginServiceUser.user.uid).pipe(take(1)).toPromise();
      if (databaseUser) {
        await this.router.navigate(['/dashboard']);
        this.snackBar.open(`Welcome back ${databaseUser.displayName || 'Anonymous'}`, null, {
          duration: 2000,
        });
        return;
      }
      this.showUserAgreementFormDialog(new User(loginServiceUser.user.uid, loginServiceUser.user.displayName, loginServiceUser.user.photoURL))
    } catch (e) {
      Raven.captureException(e);
      this.isLoggingIn = false;
    }
  }

  private showUserAgreementFormDialog(user: User) {
    const dialogRef = this.dialog.open(UserAgreementFormComponent, {
      width: '75vw',
      disableClose: true,
      data: {
        user: user,
      },
    });

    dialogRef.afterClosed().subscribe(result => {
      this.isLoggingIn = false;
    });
  }

}
