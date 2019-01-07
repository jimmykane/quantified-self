import {Component, OnInit} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {ActivatedRoute, Params, Router} from '@angular/router';
import {Subscription} from 'rxjs';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {AppAuthService} from '../../authentication/app.auth.service';
import {MatSnackBar} from '@angular/material';
import {SideNavService} from "../../services/side-nav/side-nav.service";


@Component({
  selector: 'app-sidenav',
  templateUrl: './sidenav.component.html',
  styleUrls: ['./sidenav.component.css'],
})
export class SideNavComponent implements OnInit {

  public events: EventInterface[] = [];

  constructor(public authService: AppAuthService, public sideNav: SideNavService, private snackBar: MatSnackBar, private router: Router , private eventService: EventService,  private route: ActivatedRoute) {
  }

  ngOnInit() {
  }

  async logout() {
    await this.authService.signOut();
    this.router.navigate(['/home']).then(() => {
      this.snackBar.open('Signed out');
    });
  }
}
