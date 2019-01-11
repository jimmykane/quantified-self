import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
// import {EventExporterTCX} from 'quantified-self-lib/lib/events/adapters/exporters/exporter.tcx';
import {EventService} from '../../services/app.event.service';
import {FileService} from '../../services/app.file.service';
import {EventFormComponent} from '../event-form/event.form.component';
import {MatDialog, MatSnackBar} from '@angular/material';
import {EventExporterJSON} from 'quantified-self-lib/lib/events/adapters/exporters/exporter.json';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {ClipboardService} from '../../services/app.clipboard.service';
import {SharingService} from '../../services/app.sharing.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {UserService} from '../../services/app.user.service';
import {UserFormComponent} from '../user-forms/user.form.component';

@Component({
  selector: 'app-user-actions',
  templateUrl: './user.actions.component.html',
  styleUrls: ['./user.actions.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})
export class UserActionsComponent implements OnInit {
  @Input() user: User;

  constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private userService: UserService,
    private router: Router,
    private snackBar: MatSnackBar,
    private clipboardService: ClipboardService,
    private sharingService: SharingService,
    private dialog: MatDialog) {
  }

  ngOnInit(): void {
    if (!this.user) {
      throw "User is required"
    }
  }

  async share() {
    if (this.user.privacy !== Privacy.public) {
      await this.userService.setUserPrivacy(this.user, Privacy.public);
    }
    this.clipboardService.copyToClipboard(this.sharingService.getShareURLForUser(this.user.uid));
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
