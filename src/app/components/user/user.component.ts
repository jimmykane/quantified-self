import {Component, Inject, OnDestroy, OnInit} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {Privacy} from '@sports-alliance/sports-lib/lib/privacy/privacy.class.interface';
import {User} from '@sports-alliance/sports-lib/lib/users/user';
import {of, Subscription} from 'rxjs';
import {AppAuthService} from '../../authentication/app.auth.service';
import {AppUserService} from '../../services/app.user.service';
import {MatDialog, MatDialogRef} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {catchError, map, switchMap} from 'rxjs/operators';
import {UserFormComponent} from '../user-forms/user.form.component';

@Component({
  selector: 'app-user',
  templateUrl: './user.component.html',
  styleUrls: ['./user.component.css'],
})
export class UserComponent implements OnInit, OnDestroy {

  public user: User;
  private userSubscription: Subscription;

  constructor(private authService: AppAuthService, private route: ActivatedRoute, private userService: AppUserService, private router: Router, private snackBar: MatSnackBar, private dialog: MatDialog,) {
  }

  ngOnInit(): void {
   this.userSubscription = this.route.data.subscribe((data) => {
     // First get our current user
     this.user = data.user;
   })
  }

  edit() {
    const dialogRef = this.dialog.open(UserFormComponent, {
      width: '75vw',
      disableClose: false,
      data: {
        user: this.user,
      },
    });

    // dialogRef.afterClosed().subscribe(result => {
    // });
  }

  ngOnDestroy(): void {
    this.userSubscription.unsubscribe();
  }
}
