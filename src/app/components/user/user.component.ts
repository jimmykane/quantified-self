import {Component, Inject, OnDestroy, OnInit} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {User} from 'quantified-self-lib/lib/users/user';
import {of, Subscription} from 'rxjs';
import {AppAuthService} from '../../authentication/app.auth.service';
import {UserService} from '../../services/app.user.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {catchError, map, switchMap} from 'rxjs/operators';
import {UserFormComponent} from '../user-forms/user.form.component';

@Component({
  selector: 'app-user',
  templateUrl: './user.component.html',
  styleUrls: ['./user.component.css'],
})
export class UserComponent implements OnInit, OnDestroy {

  public currentUser: User;
  public targetUser: User;
  private userSubscription: Subscription;

  constructor(private authService: AppAuthService, private route: ActivatedRoute, private userService: UserService, private router: Router, private snackBar: MatSnackBar, private dialog: MatDialog,) {
  }

  ngOnInit(): void {
    const userID = this.route.snapshot.paramMap.get('userID');
    if (userID) {
      this.targetUser = new User(userID);
    }

    this.userSubscription = this.authService.user.pipe(map((user) => {
      // First get our current user
      this.currentUser = user;
      return this.currentUser;
    })).pipe(switchMap((currentUser) => {
      // 1. If the current user is the targetOne return the current user and noop
      if (this.isOwner()) {
        return of(this.currentUser);
      }
      // 2. Else try to get the target user
      return this.userService.getUserByID(this.targetUser.uid);
    })).pipe(catchError((error) => {
      return of(null);
    })).subscribe((targetUser) => {
      // 3. If no target shoo
      if (!targetUser) {
        this.router.navigate(['home']).then(() => {
          this.snackBar.open('Not found...', null, {
            duration: 10000,
          });
        });
        return
      }
      // Populate placeholders for display name etc
      if (!targetUser.displayName){
        targetUser.displayName = 'Anonymous';
      }
      if(!targetUser.photoURL){
        targetUser.photoURL = `https://ui-avatars.com/api/?name=${targetUser.displayName}`
      }

      this.targetUser = targetUser;
    })
  }

  edit() {
    const dialogRef = this.dialog.open(UserFormComponent, {
      width: '75vw',
      disableClose: false,
      data: {
        user: this.currentUser,
      },
    });

    // dialogRef.afterClosed().subscribe(result => {
    // });
  }

  isOwner() {
    return !!(this.currentUser && this.targetUser && (this.currentUser.uid === this.targetUser.uid));
  }

  ngOnDestroy(): void {
    this.userSubscription.unsubscribe();
  }
}
