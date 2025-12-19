import { Component } from '@angular/core';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { POLICY_CONTENT, PolicyItem } from '../../shared/policies.content';

@Component({
  selector: 'app-policies',
  templateUrl: './policies.component.html',
  styleUrls: ['./policies.component.css'],
  standalone: false
})
export class PoliciesComponent {
  policies: PolicyItem[] = POLICY_CONTENT;

  constructor(public authService: AppAuthService, public router: Router) {

  }
}
