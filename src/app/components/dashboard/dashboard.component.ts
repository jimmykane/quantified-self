import {Component, OnChanges, OnDestroy, OnInit, } from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {of, Subscription} from 'rxjs';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {Router} from '@angular/router';
import {MatSnackBar} from '@angular/material/snack-bar';
import {AppAuthService} from '../../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {DateRanges} from 'quantified-self-lib/lib/users/user.dashboard.settings.interface';
import {getDatesForDateRange} from '../event-search/event-search.component';
import {UserService} from '../../services/app.user.service';
import {removeAnimation} from '../../animations/animations';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
  animations: [removeAnimation]
})

export class DashboardComponent implements OnInit, OnDestroy, OnChanges {
  user: User;
  events: EventInterface[];
  userSubscription: Subscription;
  searchTerm: string;
  searchStartDate: Date;
  searchEndDate: Date;

  constructor(private router: Router,
              private authService: AppAuthService,
              private eventService: EventService,
              private userService: UserService,
              private snackBar: MatSnackBar) {

  }

  ngOnInit() {
    this.userSubscription = this.authService.user.subscribe((user) => {
      if (!user) {
        this.router.navigate(['home']).then(() => {
          this.snackBar.open('Logged out')
        });
        return of(null);
      }
      this.user = user;
      if (this.user.settings.dashboardSettings.dateRange === DateRanges.custom  && this.user.settings.dashboardSettings.startDate && this.user.settings.dashboardSettings.endDate) {
        this.searchStartDate = new Date(this.user.settings.dashboardSettings.startDate);
        this.searchEndDate = new Date(this.user.settings.dashboardSettings.endDate);
        return;
      }
      this.searchStartDate = getDatesForDateRange(this.user.settings.dashboardSettings.dateRange).startDate;
      this.searchEndDate = getDatesForDateRange(this.user.settings.dashboardSettings.dateRange).endDate;
    });
  }

  search(search: {searchTerm: string, startDate: Date, endDate: Date, dateRange: DateRanges}) {
    this.searchTerm = search.searchTerm;
    this.searchStartDate = search.startDate;
    this.searchEndDate = search.endDate;
    this.user.settings.dashboardSettings.dateRange = search.dateRange;
    this.user.settings.dashboardSettings.startDate = search.startDate  && search.startDate.getTime();
    this.user.settings.dashboardSettings.endDate = search.endDate &&  search.endDate.getTime();
    this.userService.updateUserProperties(this.user, {settings: this.user.settings} )
  }

  ngOnChanges() {
  }

  ngOnDestroy(): void {
    this.userSubscription.unsubscribe();
  }
}
