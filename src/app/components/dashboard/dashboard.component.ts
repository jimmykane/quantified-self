import {ChangeDetectorRef, Component, OnChanges, OnDestroy, OnInit, } from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {combineLatest, of, Subscription} from 'rxjs';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {Router} from '@angular/router';
import {MatSnackBar} from '@angular/material/snack-bar';
import {AppAuthService} from '../../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {DateRanges} from 'quantified-self-lib/lib/users/user.dashboard.settings.interface';
import {getDatesForDateRange} from '../event-search/event-search.component';
import {UserService} from '../../services/app.user.service';
import {DaysOfTheWeek} from 'quantified-self-lib/lib/users/user.unit.settings.interface';
import {ActionButtonService} from '../../services/action-buttons/app.action-button.service';
import {ActionButton} from '../../services/action-buttons/app.action-button';
import {flatMap, mergeMap, switchMap} from 'rxjs/operators';
import * as Sentry from '@sentry/browser';
import WhereFilterOp = firebase.firestore.WhereFilterOp;

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})

export class DashboardComponent implements OnInit, OnDestroy, OnChanges {
  public user: User;
  public events: EventInterface[];
  public dataSubscription: Subscription;
  public searchTerm: string;
  public searchStartDate: Date;
  public searchEndDate: Date;
  public startOfTheWeek: DaysOfTheWeek;
  public showUpload: boolean = this.authService.isCurrentUserAnonymous();

  constructor(private router: Router,
              public authService: AppAuthService,
              private eventService: EventService,
              private userService: UserService,
              private actionButtonService: ActionButtonService,
              private  changeDetector: ChangeDetectorRef,
              private snackBar: MatSnackBar) {
    this.actionButtonService.addActionButton('turnOnUpload', new ActionButton('cloud_upload', () => {
      this.showUpload = !this.showUpload;
    }));
  }

  ngOnInit() {
    this.dataSubscription = this.authService.user.pipe(switchMap((user) => {
      // Get the user
      if (!user) {
        this.router.navigate(['home']).then(() => {
          this.snackBar.open('Logged out')
        });
        return of(null);
      }
      this.user = user;
      // Setup the ranges to search depending on pref
      if (this.user.settings.dashboardSettings.dateRange === DateRanges.custom && this.user.settings.dashboardSettings.startDate && this.user.settings.dashboardSettings.endDate) {
        this.searchStartDate = new Date(this.user.settings.dashboardSettings.startDate);
        this.searchEndDate = new Date(this.user.settings.dashboardSettings.endDate);
        return;
      }

      this.searchStartDate = getDatesForDateRange(this.user.settings.dashboardSettings.dateRange, this.user.settings.unitSettings.startOfTheWeek).startDate;
      this.searchEndDate = getDatesForDateRange(this.user.settings.dashboardSettings.dateRange, this.user.settings.unitSettings.startOfTheWeek).endDate;
      this.startOfTheWeek = this.user.settings.unitSettings.startOfTheWeek;

      const limit = 0; // @todo double check this how it relates
      const where = [];
      if (this.searchTerm) {
        where.push({
          fieldPath: 'name',
          opStr: <WhereFilterOp>'==',
          value: this.searchTerm
        });
      }
      if (!this.searchStartDate || !this.searchEndDate) {
        const error = new Error(`Search startDate or endDate are missing`);
        Sentry.captureException(error);
        throw error;
      }
      // this.searchStartDate.setHours(0, 0, 0, 0); // @todo this should be moved to the search component
      where.push({
        fieldPath: 'startDate',
        opStr: <WhereFilterOp>'>=',
        value: this.searchStartDate.getTime() // Should remove mins from date
      });
      // this.searchEndDate.setHours(24, 0, 0, 0);
      where.push({
        fieldPath: 'startDate',
        opStr: <WhereFilterOp>'<=', // Should remove mins from date
        value: this.searchEndDate.getTime()
      });

      // Get what is needed
      return this.eventService.getEventsForUserBy(this.user, where, 'startDate', false, limit);
    })).subscribe((events) => {
      this.events = events;
    });

  }

  search(search: { searchTerm: string, startDate: Date, endDate: Date, dateRange: DateRanges }) {
    this.searchTerm = search.searchTerm;
    this.searchStartDate = search.startDate;
    this.searchEndDate = search.endDate;
    this.user.settings.dashboardSettings.dateRange = search.dateRange;
    this.user.settings.dashboardSettings.startDate = search.startDate && search.startDate.getTime();
    this.user.settings.dashboardSettings.endDate = search.endDate && search.endDate.getTime();
    this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  ngOnChanges() {
  }

  ngOnDestroy(): void {
    this.dataSubscription.unsubscribe();
    this.actionButtonService.removeActionButton('turnOnUpload');
  }
}
