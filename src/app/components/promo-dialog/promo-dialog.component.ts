import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, OnInit, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../services/app.user.service';
import { Analytics, logEvent } from '@angular/fire/analytics';


@Component({
  selector: 'app-event-form',
  templateUrl: './promo-dialog.component.html',
  styleUrls: ['./promo-dialog.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})


export class PromoDialogComponent implements OnInit {

  public user: User;
  private analytics = inject(Analytics);

  constructor(
    public dialogRef: MatDialogRef<PromoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) private data: any,
    private userService: AppUserService,
    private snackBar: MatSnackBar,
  ) {
    this.user = data.user; // Perhaps move to service?
  }

  ngOnInit(): void {
    logEvent(this.analytics, 'promo_popup_shown');
  }

  async becomeAPatron() {
    logEvent(this.analytics, 'become_a_patron_click');
    window.open('https://www.patreon.com/dimitrioskanellopoulos');
    return this.userService.setLastSeenPromoToNow(this.user);
  }

  async gitHubSponsor() {
    logEvent(this.analytics, 'github_sponsor');
    window.open(' https://github.com/sponsors/jimmykane?utm_source=qs');
    return this.userService.setLastSeenPromoToNow(this.user);
  }

  async close(event) {
    event.stopPropagation();
    event.preventDefault();
    this.dialogRef.close();
    return this.userService.setLastSeenPromoToNow(this.user);
  }

}
