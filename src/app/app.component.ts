import {
  AfterViewChecked, AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit,
  ViewChild,
} from '@angular/core';
import {ActionButtonService} from './services/action-buttons/app.action-button.service';
import {ActionButton} from './services/action-buttons/app.action-button';
import {MatSidenav, MatSnackBar} from '@angular/material';
import {Subscription} from 'rxjs';
import {AngularFireAuth} from '@angular/fire/auth';
import {auth, User} from 'firebase';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class AppComponent implements OnInit, AfterViewInit, OnDestroy, AfterViewChecked {
  @ViewChild('sidenav') sideNav: MatSidenav;
  public actionButtons: ActionButton[] = [];
  private actionButtonsSubscription: Subscription;
  private user: User;

  constructor(private afAuth: AngularFireAuth,
              private changeDetectorRef: ChangeDetectorRef,
              private actionButtonService: ActionButtonService,
              private snackBar: MatSnackBar,) {
    this.actionButtonsSubscription = this.actionButtonService.getActionButtons().subscribe((actionButtons: Map<string, ActionButton>) => {
      this.actionButtons = Array.from(actionButtons.values());
    });
    this.afAuth.auth.onAuthStateChanged((user) => {
      if (!user) {
        this.login();
        debugger;
        return; // @todo what happens?
      }
      this.user = user;
      if (this.user.displayName) {
        // Say welcome back and name perhaps if not completelty anonymous
        this.snackBar.open(`Welcome back ${user.displayName} `, null, {
          duration: 5000,
        });
      }
    });
    this.actionButtonService.addActionButton('openSideNav', new ActionButton('list', () => {
      this.sideNav.toggle();
    }, 'material'));
  }

  ngOnInit() {
  }

  ngAfterViewInit() {

  }

  reset() {
    localStorage.clear();
    this.afAuth.auth.signOut();
    window.location.reload();
  }


  login() {
    this.afAuth.auth.signInAnonymously();
  }

  logout() {
    this.afAuth.auth.signOut();
  }

  /**
   * See https://github.com/angular/angular/issues/14748
   */
  ngAfterViewChecked() {
    this.changeDetectorRef.detectChanges();
  }

  ngOnDestroy(): void {
    this.actionButtonsSubscription.unsubscribe();
  }
}
