import {Component, Inject, OnInit} from '@angular/core';
import {AppAuthService, AppUser} from '../../authentication/app.auth.service';
import {ActivatedRoute, Router} from '@angular/router';
import {UserAbstractComponent} from '../user.abstract.component';

@Component({
  selector: 'app-user',
  templateUrl: './user.component.html',
  styleUrls: ['./user.component.css'],
})
export class UserComponent extends UserAbstractComponent {

  public userFromParams: AppUser;
  public user: AppUser;

  constructor(private route: ActivatedRoute){
    super();
  }

  ngOnInit(): void {
    const userID = this.route.snapshot.paramMap.get('userID');
    if (userID) {
      this.userFromParams = {uid: userID};
    }
  }

  isOwner() {
    return !!(this.userFromParams && this.user && (this.userFromParams.uid === this.user.uid));
  }
}
