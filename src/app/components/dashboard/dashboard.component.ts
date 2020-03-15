import {ChangeDetectorRef, Component, OnChanges, OnDestroy, OnInit} from '@angular/core';
import {AppEventService} from '../../services/app.event.service';
import {of, Subscription} from 'rxjs';
import {EventInterface} from '@sports-alliance/sports-lib/lib/events/event.interface';
import {Router} from '@angular/router';
import {MatSnackBar} from '@angular/material/snack-bar';
import {AppAuthService} from '../../authentication/app.auth.service';
import {User} from '@sports-alliance/sports-lib/lib/users/user';
import {DateRanges} from '@sports-alliance/sports-lib/lib/users/settings/dashboard/user.dashboard.settings.interface';
import {getDatesForDateRange, Search} from '../event-search/event-search.component';
import {AppUserService} from '../../services/app.user.service';
import {DaysOfTheWeek} from '@sports-alliance/sports-lib/lib/users/settings/user.unit.settings.interface';
import {AppActionButtonService} from '../../services/action-buttons/app.action-button.service';
import {ActionButton} from '../../services/action-buttons/app.action-button';
import {map, switchMap} from 'rxjs/operators';
import {MatDialog} from '@angular/material/dialog';
import {EventsExportFormComponent} from '../events-export-form/events-export.form.component';
import {AngularFireAnalytics} from '@angular/fire/analytics';
import {Log} from 'ng2-logger/browser';
import {ActivityTypes} from '@sports-alliance/sports-lib/lib/activities/activity.types';
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
  public isLoading: boolean;
  public showUpload = false;
  public isInitialized = false;

  private shouldSearch: boolean;

  private logger = Log.create('DashboardComponent');


  constructor(private router: Router,
              public authService: AppAuthService,
              private eventService: AppEventService,
              private userService: AppUserService,
              private actionButtonService: AppActionButtonService,
              private  changeDetector: ChangeDetectorRef,
              private afa: AngularFireAnalytics,
              private dialog: MatDialog,
              private snackBar: MatSnackBar) {
    this.addUploadButton();
  }

  ngOnInit() {
    this.logger.info(`On Init`);
    this.shouldSearch = true;
    this.dataSubscription = this.authService.user.pipe(switchMap((user) => {
      this.logger.info(`User subscription`);
      this.isLoading = true;
      // Get the user
      if (!user) {
        this.router.navigate(['login']).then(() => {
          this.snackBar.open('You were signed out out')
        });
        return of({user: null, events: null});
      }

      this.showUpload = this.authService.isGuest();

      if (this.user && (
        this.user.settings.dashboardSettings.dateRange !== user.settings.dashboardSettings.dateRange
        || this.user.settings.dashboardSettings.startDate !== user.settings.dashboardSettings.startDate
        || this.user.settings.dashboardSettings.endDate !== user.settings.dashboardSettings.endDate
        || this.user.settings.unitSettings.startOfTheWeek !== user.settings.unitSettings.startOfTheWeek
      )) {
        this.shouldSearch = true;
      }

      // Setup the ranges to search depending on pref
      if (user.settings.dashboardSettings.dateRange === DateRanges.custom && user.settings.dashboardSettings.startDate && user.settings.dashboardSettings.endDate) {
        this.searchStartDate = new Date(user.settings.dashboardSettings.startDate);
        this.searchEndDate = new Date(user.settings.dashboardSettings.endDate);
      } else {
        this.searchStartDate = getDatesForDateRange(user.settings.dashboardSettings.dateRange, user.settings.unitSettings.startOfTheWeek).startDate;
        this.searchEndDate = getDatesForDateRange(user.settings.dashboardSettings.dateRange, user.settings.unitSettings.startOfTheWeek).endDate;
      }

      this.startOfTheWeek = user.settings.unitSettings.startOfTheWeek;

      const limit = 0; // @todo double check this how it relates
      const where = [];
      if (this.searchTerm) {
        where.push({
          fieldPath: 'name',
          opStr: <WhereFilterOp>'==',
          value: this.searchTerm
        });
      }

      if ((!this.searchStartDate || !this.searchEndDate) && user.settings.dashboardSettings.dateRange === DateRanges.custom) {
        return of({events: [], user: user})
      }
      if (user.settings.dashboardSettings.dateRange !== DateRanges.all) {
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
      }

      // Get what is needed
      const returnObservable = this.shouldSearch ?
        this.eventService
          .getEventsForUserBy(user, where, 'startDate', false, limit)
        : this.events.length ? of(this.events) : this.eventService
          .getEventsForUserBy(user, where, 'startDate', false, limit);
      return returnObservable
        .pipe(map((eventsArray) => {
          const t0 = performance.now();
          if (!user.settings.dashboardSettings.activityTypes || !user.settings.dashboardSettings.activityTypes.length) {
            this.logger.info(`Took ${performance.now() - t0}ms to filter`);
            return eventsArray;
          }
          const result = eventsArray.filter(event => {
            return event.getActivityTypesAsArray().some(activityType => user.settings.dashboardSettings.activityTypes.indexOf(ActivityTypes[activityType]) >= 0)
          });
          this.logger.info(`Took ${performance.now() - t0}ms to filter ${eventsArray.length}`);
          return result;
        }))
        .pipe(map((events) => {
          return {events: events, user: user}
        }))
    })).subscribe((eventsAndUser) => {
      this.logger.info(`Events and user subscription`);
      this.shouldSearch = false;
      this.events = eventsAndUser.events || [];
      this.user = eventsAndUser.user;
      if (this.events && this.events.length) {
        this.addExportButton();
      } else {
        this.removeExportButton();
      }
      this.isLoading = false;
      this.isInitialized = true;
    });
  }

  async search(search: Search) {
    this.shouldSearch = true;
    this.searchTerm = search.searchTerm;
    this.searchStartDate = search.startDate;
    this.searchEndDate = search.endDate;
    this.user.settings.dashboardSettings.dateRange = search.dateRange;
    this.user.settings.dashboardSettings.startDate = search.startDate && search.startDate.getTime();
    this.user.settings.dashboardSettings.endDate = search.endDate && search.endDate.getTime();
    this.user.settings.dashboardSettings.activityTypes = search.activityTypes;
    this.afa.logEvent('dashboard_search', {method: DateRanges[search.dateRange]});
    await this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  ngOnChanges() {
    this.logger.info(`On Changes`);
  }

  ngOnDestroy(): void {
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
    }
    this.removeExportButton();
    this.removeUploadButton();
  }

  private addUploadButton() {
    this.actionButtonService.addActionButton('turnOnUpload', new ActionButton('cloud_upload', () => {
      this.showUpload = !this.showUpload;
    }));
  }

  private removeUploadButton() {
    this.actionButtonService.removeActionButton('turnOnUpload');
  }

  private addExportButton() {
    this.actionButtonService.addActionButton('export', new ActionButton('arrow_downward', () => {
      const dialogRef = this.dialog.open(EventsExportFormComponent, {
        // width: '100vw',
        disableClose: false,
        data: {
          events: this.events,
          user: this.user,
        },
      });
    }));
  }

  private removeExportButton() {
    this.actionButtonService.removeActionButton('export');
  }
}
