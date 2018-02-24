import {Component} from '@angular/core';

declare function require(moduleName: string): any;
const { version: appVersion } = require('../../../../package.json');


@Component({
  selector: 'app-about',
  templateUrl: './about.component.html',
  styleUrls: ['./about.component.css'],
})
export class AboutComponent {
  public appVersion = appVersion;
}
