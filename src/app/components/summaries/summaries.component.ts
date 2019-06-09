import {
  Component, Input, OnChanges, OnDestroy,
  OnInit,
} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {combineLatest, merge, of, Subscription} from 'rxjs';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {catchError, map, startWith, switchMap} from 'rxjs/operators';
import {Router} from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import {AppAuthService} from '../../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {MatTableDataSource} from '@angular/material';
import * as Sentry from '../event-table/event.table.component';
import WhereFilterOp = firebase.firestore.WhereFilterOp;
import {ChartThemes} from "quantified-self-lib/lib/users/user.chart.settings.interface";
import {ThemeService} from "../../services/app.theme.service";

@Component({
  selector: 'app-summaries',
  templateUrl: './summaries.component.html',
  styleUrls: ['./summaries.component.css'],
})

export class SummariesComponent implements OnInit, OnDestroy, OnChanges {
  @Input() searchTerm: string;
  @Input() searchStartDate: Date;
  @Input() searchEndDate: Date;
  @Input() user: User;

  isLoading = true;
  events: EventInterface[];
  pieChartData: any[];
  private eventsSubscription: Subscription;
  private chartThemeSubscription: Subscription;
  private chartTheme: ChartThemes;


  constructor(private router: Router, private authService: AppAuthService, private eventService: EventService, private themeService: ThemeService, private snackBar: MatSnackBar) {

  }

  ngOnInit() {



  }

  ngOnChanges() {
    this.subscribeToAll()
  }

  private subscribeToAll() {
    this.unsubscribeFromAll();
    this.isLoading = true;
    // Subscribe to the chartTheme changes
    this.chartThemeSubscription = this.themeService.getChartTheme().subscribe((chartTheme) => {
      this.chartTheme = chartTheme;
    });
    const where = [];
    if (this.searchTerm) {
      where.push({
        fieldPath: 'name',
        opStr: <WhereFilterOp>'==',
        value: this.searchTerm
      })
    }
    if (this.searchStartDate) {
      this.searchStartDate.setHours(0, 0, 0, 0) ;
      where.push({
        fieldPath: 'startDate',
        opStr: <WhereFilterOp>'>=',
        value: this.searchStartDate.getTime() // Should remove mins from date
      })
    }
    if (this.searchEndDate) {
      this.searchEndDate.setHours(24, 0, 0, 0) ;
      where.push({
        fieldPath: 'startDate',
        opStr: <WhereFilterOp>'<=', // Should remove mins from date
        value: this.searchEndDate.getTime()
      })
    }
    this.eventsSubscription = this.eventService.getEventsAndActivitiesForUserBy(this.user, where, 'startDate', false).subscribe(events => {
      this.pieChartData = this.getPieChartData(events);
    });
  }

  private unsubscribeFromAll() {
    if (this.eventsSubscription) {
      this.eventsSubscription.unsubscribe();
    }
  }

  ngOnDestroy(): void {
    // this.userSubscription.unsubscribe();
  }

  private getPieChartData(events: EventInterface[]) {
    return [{
      type: 'Fossil Energy',
      percent: 70,
      subs: [{
        type: 'Oil',
        percent: 15
      }, {
        type: 'Coal',
        percent: 35
      }, {
        type: 'Nuclear',
        percent: 20
      }]
    }, {
      type: 'Green Energy',
      percent: 30,
      subs: [{
        type: 'Hydro',
        percent: 15
      }, {
        type: 'Wind',
        percent: 10
      }, {
        type: 'Other',
        percent: 5
      }]
    }];
  }
}
