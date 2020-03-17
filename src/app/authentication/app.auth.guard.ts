import { Injectable } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivate,
  CanLoad,
  Route,
  Router,
  RouterStateSnapshot,
  UrlSegment
} from '@angular/router';
import { Observable } from 'rxjs';
import { AppAuthService } from './app.auth.service';
import { map, take, tap } from 'rxjs/operators';
import { Log } from 'ng2-logger/browser';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root'
})
export class AppAuthGuard implements CanActivate, CanLoad {
  private logger = Log.create('AppAuthGuard');

  constructor(private authService: AppAuthService, private router: Router, private snackBar: MatSnackBar) {
  }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {
    return this.checkLogin(state.url);
  }

  canLoad(route: Route, segments: UrlSegment[]): Observable<boolean> | Promise<boolean> | boolean {
    return this.checkLogin(`/${route.path}`);
  }

  checkLogin(url: string): Observable<boolean> | Promise<boolean> | boolean{
    return this.authService.user.pipe(take(1)).pipe(map(user => !!user)).pipe(tap(loggedIn => {
      this.authService.redirectUrl = null;
      if (loggedIn) {
        return true
      }
      this.authService.redirectUrl = url;
      this.snackBar.open('You must login first', null, {
        duration: 2000,
      });
      return this.router.navigate(['/login']);
    }))
  }
}
