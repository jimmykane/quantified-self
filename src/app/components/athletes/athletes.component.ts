import { ChangeDetectionStrategy, Component, HostListener, Input, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppCoachingService } from '../../services/app.coaching.service';
import { of, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-athletes',
  templateUrl: './athletes.component.html',
  styleUrls: ['./athletes.component.css'],
  providers: [],
})
export class AthletesComponent implements OnInit, OnDestroy {
  public user: User;
  public athletes: User[];
  public isLoading: boolean;

  public rowHeight: string;
  public numberOfCols: number;

  private userAndAthletesSubscription: Subscription;

  constructor(
    private authService: AppAuthService,
    private coachingService: AppCoachingService,
    private router: Router,
    private snackBar: MatSnackBar) {
    this.rowHeight = this.getRowHeight();
    this.numberOfCols = this.getNumberOfColumns();
  }

  ngOnInit(): void {
    this.authService.user.pipe(switchMap((user) => {
      this.isLoading = true;
      this.user = user;
      if (!user) {
        this.router.navigate(['login']).then(() => {
          this.snackBar.open('You were signed out out')
        });
        return of(null);
      }
      return this.coachingService.getCoachedAthletesForUser(this.user)
    })).subscribe((users) => {
      this.athletes = users;
      this.isLoading = false;
    })
  }



  @HostListener('window:resize', ['$event'])
  @HostListener('window:orientationchange', ['$event'])
  resizeOROrientationChange(event?) {
    this.numberOfCols = this.getNumberOfColumns();
    this.rowHeight = this.getRowHeight();
  }

  // @todo refactor
  private getRowHeight() {
    const angle = (window.screen && window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
    return (angle === 90 || angle === -90) ? '40vw' : '40vh';
  }

  private getNumberOfColumns() {
    if (window.innerWidth < 860) {
      return 1;
    }
    if (window.innerWidth < 1500) {
      return 2;
    }
    return 4;
  }

  ngOnDestroy(): void {
    if (this.userAndAthletesSubscription) {
      this.userAndAthletesSubscription.unsubscribe();
    }
  }
}
