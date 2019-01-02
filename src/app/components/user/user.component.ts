import {Component, Inject, OnDestroy, OnInit} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {UserAbstractComponent} from '../user.abstract.component';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {User} from 'quantified-self-lib/lib/users/user';
import {Subscription} from 'rxjs';
import {AppAuthService} from '../../authentication/app.auth.service';
import {UserService} from '../../services/app.user.service';
import {MatSnackBar} from '@angular/material';

@Component({
  selector: 'app-user',
  templateUrl: './user.component.html',
  styleUrls: ['./user.component.css'],
})
export class UserComponent implements OnInit, OnDestroy {

  public userFromParams: User;
  public user: User;
  private userSubscription: Subscription;

  constructor(private authService: AppAuthService, private route: ActivatedRoute, private userService: UserService, private router: Router, private snackBar: MatSnackBar) {
  }

  ngOnInit(): void {
    const userID = this.route.snapshot.paramMap.get('userID');
    if (userID) {
      this.userFromParams = new User(userID);
    }

    this.userSubscription = this.authService.user.subscribe((user) => {
      this.user = user;
    });
  }

  public async deleteUser() {
    await this.userService.deleteAllUserData(this.user);
    await this.authService.signOut();
    await this.router.navigate(['home']);
    this.snackBar.open('Account deleted! You are now logged out.', null, {
      duration: 10000,
    });
  }

  isOwner() {
    return !!(this.userFromParams && this.user && (this.userFromParams.uid === this.user.uid));
  }

  ngOnDestroy(): void {
    this.userSubscription.unsubscribe();
  }
}
