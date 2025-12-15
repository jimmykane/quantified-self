import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {Privacy} from '@sports-alliance/sports-lib';
import {AppSharingService} from '../../services/app.sharing.service';
import {User} from '@sports-alliance/sports-lib';
import {AppUserService} from '../../services/app.user.service';
import {UserFormComponent} from '../user-forms/user.form.component';
import { Clipboard } from '@angular/cdk/clipboard';

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

  constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private userService: AppUserService,
    private router: Router,
    private snackBar: MatSnackBar,
    private clipboardService: Clipboard,
    private sharingService: AppSharingService,
    private dialog: MatDialog) {
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error('User is required');
    }
  }

  async share() {
    if (this.user.privacy !== Privacy.Public) {
      await this.userService.setUserPrivacy(this.user, Privacy.Public);
    }
    this.clipboardService.copy(this.sharingService.getShareURLForUser(this.user.uid));
    this.snackBar.open('Your user privacy is now changed to public and share url is copied to clipboard', null, {
      duration: 20000,
    });
  }

  edit() {
    const dialogRef = this.dialog.open(UserFormComponent, {
      width: '75vw',
      disableClose: false,
      data: {
        user: this.user
      },
    });

    // dialogRef.afterClosed().subscribe(result => {
    // });
  }
}
