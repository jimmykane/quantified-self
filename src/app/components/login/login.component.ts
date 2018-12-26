import {Component} from '@angular/core';
import {AppAuthService} from '../../authentication/app.auth.service';

declare function require(moduleName: string): any;
const { version: appVersion } = require('../../../../package.json');


@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent {
  public appVersion = appVersion;

  constructor(public authService: AppAuthService){}

}
