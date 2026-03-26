import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { User } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-user-actions',
  templateUrl: './user.actions.component.html',
  styleUrls: ['./user.actions.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class UserActionsComponent implements OnInit {
  @Input() user: User;

  ngOnInit(): void {
    if (!this.user) {
      throw new Error('User is required');
    }
  }
}
