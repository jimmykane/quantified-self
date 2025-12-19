import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { User } from '@sports-alliance/sports-lib';
import { Subscription } from 'rxjs';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';


@Component({
  selector: 'app-user',
  templateUrl: './user.component.html',
  styleUrls: ['./user.component.css'],
  standalone: false
})
export class UserComponent implements OnInit, OnDestroy {

  public user: User;
  private userSubscription: Subscription;

  constructor(private authService: AppAuthService,
    private route: ActivatedRoute,
    private userService: AppUserService,
    private router: Router,
    private snackBar: MatSnackBar) {
  }

  ngOnInit(): void {
    this.userSubscription = this.authService.user$.subscribe((user) => {
      if (!user) {
        this.router.navigate(['login']).then(() => {
          this.snackBar.open('You were signed out out')
        });
      }
      // First get our current user
      this.user = user;
    })
  }



  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }
}
