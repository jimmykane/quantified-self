import { ChangeDetectorRef, Component, OnChanges, OnDestroy, OnInit, inject } from '@angular/core';
import { AppEventService } from '../../services/app.event.service';
import { asyncScheduler, of, Subscription } from 'rxjs';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAuthService } from '../../authentication/app.auth.service';
import { User } from '@sports-alliance/sports-lib';
import { DateRanges } from '@sports-alliance/sports-lib';
import { Search } from '../event-search/event-search.component';
import { AppUserService } from '../../services/app.user.service';
import { DaysOfTheWeek } from '@sports-alliance/sports-lib';
import { map, switchMap, take, throttleTime } from 'rxjs/operators';
import { Analytics, logEvent } from '@angular/fire/analytics';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { PromoDialogComponent } from '../promo-dialog/promo-dialog.component';
import { getDatesForDateRange } from '../../helpers/date-range-helper';
import { WhereFilterOp } from 'firebase/firestore';


@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  standalone: false
})

export class DashboardComponent implements OnInit, OnDestroy, OnChanges {
  public user: User;
  public targetUser: User;
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
  private promoDialogRef: MatDialogRef<PromoDialogComponent>

  private analytics = inject(Analytics);


  constructor(public authService: AppAuthService,
    private router: Router,
    private eventService: AppEventService,
    private userService: AppUserService,
    private changeDetector: ChangeDetectorRef,
    private route: ActivatedRoute,
    private dialog: MatDialog,
    private snackBar: MatSnackBar) {
  }

  async ngOnInit() {

    const resolvedData = this.route.snapshot.data['dashboardData'];
    if (resolvedData) {
      this.events = resolvedData.events || [];
      this.user = resolvedData.user;
      this.targetUser = resolvedData.targetUser;
      this.isLoading = false;
      this.isInitialized = true;
      this.showPromoForUserOrDoNothing(this.user);

      if (this.user) {
        if (this.user.settings.dashboardSettings.dateRange === DateRanges.custom && this.user.settings.dashboardSettings.startDate && this.user.settings.dashboardSettings.endDate) {
          this.searchStartDate = new Date(this.user.settings.dashboardSettings.startDate);
          this.searchEndDate = new Date(this.user.settings.dashboardSettings.endDate);
        } else if (this.user.settings.unitSettings?.startOfTheWeek !== undefined) {
          const range = getDatesForDateRange(this.user.settings.dashboardSettings.dateRange, this.user.settings.unitSettings.startOfTheWeek);
          this.searchStartDate = range.startDate;
          this.searchEndDate = range.endDate;
        }
        this.startOfTheWeek = this.user.settings.unitSettings?.startOfTheWeek;
      }
    }

    this.shouldSearch = false;

    // @todo make this an obsrvbl
    const userID = this.route.snapshot.paramMap.get('userID');
    if (userID && !this.targetUser) { // Only fetch if not resolved
      try {
        this.targetUser = await this.userService.getUserByID(userID).pipe(take(1)).toPromise();
      } catch (e) {
        return this.router.navigate(['dashboard']).then(() => {
          this.snackBar.open('Page not found');
        });
      }
    }
    this.dataSubscription = this.authService.user$.pipe(switchMap((user: User | null) => {

      if (this.shouldSearch || !this.isInitialized) {
        this.isLoading = true;
      }

      // Get the user
      if (!user) {
        this.router.navigate(['login']).then(() => {
          this.snackBar.open('You were signed out out')
        });
        return of({ user: null, events: null });
      }

      // this.showUpload = this.authService.isGuest();

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
        return of({ events: [], user: user })
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
      const returnObservable = this.eventService
        .getEventsBy(this.targetUser ? this.targetUser : user, where, 'startDate', false, limit);
      return returnObservable
        .pipe(map((eventsArray) => {
          const t0 = performance.now();
          if (!user.settings.dashboardSettings.activityTypes || !user.settings.dashboardSettings.activityTypes.length) {

            return eventsArray;
          }
          const result = eventsArray.filter(event => {
            return event.getActivityTypesAsArray().some(activityType => user.settings.dashboardSettings.activityTypes.indexOf(ActivityTypes[activityType]) >= 0)
          });

          return result;
        }))
        .pipe(map((events) => {
          return { events: events, user: user }
        }))
    })).subscribe((eventsAndUser) => {

      this.shouldSearch = false;
      this.events = eventsAndUser.events || [];
      this.user = eventsAndUser.user;
      this.isLoading = false;
      this.isInitialized = true;
      this.showPromoForUserOrDoNothing(this.user);
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
    logEvent(this.analytics, 'dashboard_search', { method: DateRanges[search.dateRange] });
    await this.userService.updateUserProperties(this.user, { settings: this.user.settings })
  }

  ngOnChanges() {

  }

  async showPromoForUserOrDoNothing(user: User) {
    if (!this.userService.shouldShowPromo(user)) {
      return
    }
    // Show the modal
    if (this.promoDialogRef) {
      return;
    }
    this.promoDialogRef = this.dialog.open(PromoDialogComponent, {
      // width: '75vw',
      disableClose: true,
      data: {
        user: user
      },
    })
  }

  ngOnDestroy(): void {
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
    }
  }
}
