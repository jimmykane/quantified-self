import {Inject, OnDestroy, OnInit} from '@angular/core';
import {Subscription} from 'rxjs';
import {AppAuthService} from '../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';

export abstract class UserAbstractComponent implements OnInit, OnDestroy {

   @Inject(AppAuthService) private authService: AppAuthService;

   private userSubscription: Subscription;
   public user: User;

   ngOnInit(): void {
    this.userSubscription = this.authService.user.subscribe((user) => {
      this.user = user;
    });
  }

  ngOnDestroy(): void {
     this.userSubscription.unsubscribe();
  }
}
