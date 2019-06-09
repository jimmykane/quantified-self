import {
  Component, OnChanges, OnDestroy,
  OnInit,
} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {combineLatest, of, Subscription} from 'rxjs';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {switchMap} from 'rxjs/operators';
import {Router} from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import {AppAuthService} from '../../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})

export class DashboardComponent implements OnInit, OnDestroy, OnChanges {
  user: User;
  events: EventInterface[];
  userSubscription: Subscription;
  searchTerm: string;
  searchStartDate: Date;
  searchEndDate: Date;

  constructor(private router: Router, private authService: AppAuthService, private eventService: EventService, private snackBar: MatSnackBar) {

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
    });

    // Subscribe to a weekly events

  }

  search(search: {searchTerm: string, startDate: Date, endDate: Date}) {
    this.searchTerm = search.searchTerm;
    this.searchStartDate = search.startDate;
    this.searchEndDate = search.endDate;
  }

  ngOnChanges() {
  }

  ngOnDestroy(): void {
    this.userSubscription.unsubscribe();
  }
}
