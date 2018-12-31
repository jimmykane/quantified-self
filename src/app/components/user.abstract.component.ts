import {Inject, OnDestroy, OnInit} from '@angular/core';
import {Subscription} from 'rxjs';
import {AppAuthService} from '../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';

export abstract class UserAbstractComponent {

   @Inject(AppAuthService) private authService: AppAuthService;

}
