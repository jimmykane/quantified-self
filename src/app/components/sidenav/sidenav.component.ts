import {Component, OnInit} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {ActivatedRoute, Params, Router} from '@angular/router';
import {Subscription} from 'rxjs';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {AppAuthService} from '../../authentication/app.auth.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import {SideNavService} from "../../services/side-nav/side-nav.service";

declare function require(moduleName: string): any;
const { version: appVersion } = require('../../../../package.json');


@Component({
  selector: 'app-sidenav',
  templateUrl: './sidenav.component.html',
  styleUrls: ['./sidenav.component.css'],
})
export class SideNavComponent implements OnInit {

  public events: EventInterface[] = [];
  public appVersion = appVersion;


  constructor(public authService: AppAuthService, public sideNav: SideNavService, private snackBar: MatSnackBar, private router: Router, private eventService: EventService, private route: ActivatedRoute) {
  }

  ngOnInit() {
  }

  async logout() {
    this.router.navigate(['/home']).then(async () => {
      await this.authService.signOut();
      this.snackBar.open('Signed out', null, {
        duration: 2000,
      });
    });
  }
}
