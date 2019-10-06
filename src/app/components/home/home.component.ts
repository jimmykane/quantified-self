import {Component, HostListener} from '@angular/core';
import {AppAuthService} from '../../authentication/app.auth.service';
import {Router} from '@angular/router';

declare function require(moduleName: string): any;

const {version: appVersion} = require('../../../../package.json');


@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
})
export class HomeComponent {
  public appVersion = appVersion;

  constructor(public authService: AppAuthService, public router: Router) {

  }

  @HostListener('window:resize', ['$event'])
  getColumnsToDisplayDependingOnScreenSize(event?) {
    return window.innerWidth < 600 ? 1 : 2;
  }
}
