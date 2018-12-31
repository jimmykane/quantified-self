import {Component, Inject, OnInit} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {UserAbstractComponent} from '../user.abstract.component';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {User} from 'quantified-self-lib/lib/users/user';

@Component({
  selector: 'app-user',
  templateUrl: './user.component.html',
  styleUrls: ['./user.component.css'],
})
export class UserComponent extends UserAbstractComponent {

  public userFromParams: User;
  public user: User;

  constructor(private route: ActivatedRoute){
    super();
  }

  ngOnInit(): void {
    const userID = this.route.snapshot.paramMap.get('userID');
    if (userID) {
      this.userFromParams = {privacy: Privacy.private, uid: userID};
    }

  }

  isOwner() {
    return !!(this.userFromParams && this.user && (this.userFromParams.uid === this.user.uid));
  }
}
