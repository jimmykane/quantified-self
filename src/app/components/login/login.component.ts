import {Component} from '@angular/core';
import {AppAuthService, AppUser} from '../../authentication/app.auth.service';
import {MatSnackBar} from '@angular/material';
import {Router} from '@angular/router';

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
    this.authService.signOut().then(() => {

    });
  }

  anonymousLogin(){
    this.authService.anonymousLogin().then((user: AppUser) => {
      this.router.navigate(['/dashboard']);
      this.snackBar.open(`Welcome  ${user.displayName}`, null, {
        duration: 5000,
      });
    })
  }


  googleLogin() {
    this.authService.googleLogin().then((user: AppUser) => {
      this.router.navigate(['/dashboard']);
      this.snackBar.open(`Welcome  ${user.displayName}`, null, {
        duration: 5000,
      });
    })
  }

}
