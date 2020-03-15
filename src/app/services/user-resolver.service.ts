import { Injectable } from '@angular/core';
import { AppAuthService } from '../authentication/app.auth.service';
import { Resolve } from '@angular/router';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { take } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class UserResolverService implements Resolve<User> {

  constructor(private authService: AppAuthService) { }

  resolve(route, state) {
    return this.authService.user.pipe(take(1));
  }
}
