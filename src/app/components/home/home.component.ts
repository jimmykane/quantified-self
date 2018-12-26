import {Component} from '@angular/core';

declare function require(moduleName: string): any;
const { version: appVersion } = require('../../../../package.json');


@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
})
export class HomeComponent {
  public appVersion = appVersion;
}
