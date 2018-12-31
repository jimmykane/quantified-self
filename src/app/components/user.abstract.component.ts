import {Inject, OnDestroy, OnInit} from '@angular/core';
import {AppAuthService, AppUser} from '../authentication/app.auth.service';
import {Subscription} from 'rxjs';

export abstract class UserAbstractComponent implements OnInit, OnDestroy {

   @Inject(AppAuthService) private authService: AppAuthService;

   private userSubscription: Subscription;
   public user: AppUser;

   ngOnInit(): void {
    this.userSubscription = this.authService.user.subscribe((user) => {
      this.user = user;
    });
  }

  ngOnDestroy(): void {
     this.userSubscription.unsubscribe();
  }
}
