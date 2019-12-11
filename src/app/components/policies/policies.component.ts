import {Component} from '@angular/core';
import {AppAuthService} from '../../authentication/app.auth.service';
import {Router} from '@angular/router';

@Component({
  selector: 'app-policies',
  templateUrl: './policies.component.html',
  styleUrls: ['./policies.component.css'],
})
export class PoliciesComponent {

  constructor(public authService: AppAuthService, public router: Router) {

  }
}
