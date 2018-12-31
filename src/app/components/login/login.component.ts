import {Component} from '@angular/core';
import {MatSnackBar} from '@angular/material';
import {Router} from '@angular/router';
import {AppAuthService} from '../../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';

declare function require(moduleName: string): any;

const {version: appVersion} = require('../../../../package.json');


@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent {
  public appVersion = appVersion;

  constructor(
    public authService: AppAuthService, private router: Router,
    private snackBar: MatSnackBar) {
  }

  anonymousLogin(){
    this.authService.anonymousLogin().then((user: User) => {
      this.router.navigate(['/dashboard']);
      this.snackBar.open(`Welcome  ${user.displayName}`, null, {
        duration: 5000,
      });
    })
  }


  googleLogin() {
    this.authService.googleLogin().then((user: User) => {
      this.router.navigate(['/dashboard']);
      this.snackBar.open(`Welcome  ${user.displayName}`, null, {
        duration: 5000,
      });
    })
  }

}
