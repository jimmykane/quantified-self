import {
  Component, OnChanges, OnDestroy,
  OnInit,
} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {combineLatest, Subscription} from 'rxjs';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {AppAuthService, AppUser} from '../../authentication/app.auth.service';
import {switchMap} from 'rxjs/operators';
import {Router} from '@angular/router';
import {MatSnackBar} from '@angular/material';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})

export class DashboardComponent implements OnInit, OnDestroy, OnChanges {
  user: AppUser;
  events: EventInterface[];
  eventsSubscription: Subscription;

  constructor(private router: Router,private authService: AppAuthService, private eventService: EventService, private snackBar: MatSnackBar,) {
    this.eventsSubscription = this.authService.user.pipe(switchMap((user) => {
      if (!user){
        this.router.navigate(['home']).then(() => {
          this.snackBar.open('Logged out')
        });
        return;
      }
      this.user = user;
      return this.eventService.getEventsForUser(user);
    })).subscribe((eventsArray) => {
      this.events = eventsArray;
    });
  }

  ngOnInit() {
  }

  ngOnChanges() {
  }

  ngOnDestroy(): void {
    this.eventsSubscription.unsubscribe();
  }
}
