import {Injectable} from '@angular/core';
import {CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router} from '@angular/router';
import { Observable, of } from 'rxjs';
import {AppAuthService} from './app.auth.service';
import {map, take, tap} from 'rxjs/operators';
import {Log} from 'ng2-logger/browser';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable()
export class AppAuthGuard implements CanActivate {
  private logger = Log.create('AppAuthGuard');

  constructor(private authenticationService: AppAuthService, private router: Router, private snackBar: MatSnackBar) {
  }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {
    if (this.authenticationService.authenticated()) {
      return true;
    }

    return this.authenticationService.user.pipe(take(1)).pipe(map(user => !!user)).pipe(tap(loggedIn => {
      if (!loggedIn) {
        this.logger.warn(`Access denied`);
        this.snackBar.open('Access denied', null, {
          duration: 2000,
        });
        return this.router.navigate(['/login']);
      }
    }))

  }
}
