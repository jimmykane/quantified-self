import {Injectable} from '@angular/core';
import {CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router} from '@angular/router';
import {Observable} from 'rxjs';
import {AppAuthService} from './app.auth.service';
import {map, take, tap} from 'rxjs/operators';

@Injectable()
export class AppAuthGuard implements CanActivate {
  constructor(private authenticationService: AppAuthService, private router: Router) {
  }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {
    debugger;
    if (this.authenticationService.authenticated()) {
      return true;
    }

    return this.authenticationService.user.pipe(take(1)).pipe(map(user => !!user)).pipe(tap(loggedIn => {
      if (!loggedIn) {
        console.log("access denied");
        this.router.navigate(['/login']);
      }
    }))

  }
}
