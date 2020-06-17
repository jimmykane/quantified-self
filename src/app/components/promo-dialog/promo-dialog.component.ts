import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, OnInit} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {User} from '@sports-alliance/sports-lib/lib/users/user';
import { AppUserService } from '../../services/app.user.service';
import { AngularFireAnalytics } from '@angular/fire/analytics';


@Component({
  selector: 'app-event-form',
  templateUrl: './promo-dialog.component.html',
  styleUrls: ['./promo-dialog.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})


export class PromoDialogComponent implements OnInit {

  public user: User;

  constructor(
    public dialogRef: MatDialogRef<PromoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) private data: any,
    private userService: AppUserService,
    private snackBar: MatSnackBar,
    private afa: AngularFireAnalytics
  ) {
    this.user = data.user; // Perhaps move to service?
  }

  ngOnInit(): void {
    this.afa.logEvent('promo_popup_shown');
  }

  async becomeAPatron() {
    this.afa.logEvent('become_a_patron_click');
    window.open('https://www.patreon.com/dimitrioskanellopoulos');
    return this.userService.setLastSeenPromoToNow(this.user);
  }

  async close(event) {
    event.stopPropagation();
    event.preventDefault();
    this.dialogRef.close();
    return this.userService.setLastSeenPromoToNow(this.user);
  }

}
