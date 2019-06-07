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
  selector: 'app-summaries',
  templateUrl: './summaries.component.html',
  styleUrls: ['./summaries.component.css'],
})

export class SummariesComponent implements OnInit, OnDestroy, OnChanges {
  user: User;
  events: EventInterface[];
  userSubscription: Subscription;

  constructor(private router: Router, private authService: AppAuthService, private eventService: EventService, private snackBar: MatSnackBar) {

  }

  ngOnInit() {


    // Subscribe to a weekly events

  }

  ngOnChanges() {
  }

  ngOnDestroy(): void {
    this.userSubscription.unsubscribe();
  }
}
