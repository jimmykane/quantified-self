import {
  AfterViewChecked, AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit,
  ViewChild,
} from '@angular/core';
import {ActionButtonService} from './services/action-buttons/app.action-button.service';
import {ActionButton} from './services/action-buttons/app.action-button';
import {MatSidenav, MatSnackBar} from '@angular/material';
import {Subscription} from 'rxjs';
import {NavigationEnd, Router, RoutesRecognized} from '@angular/router';
import {filter, map} from 'rxjs/operators';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class AppComponent implements OnInit, AfterViewInit, OnDestroy, AfterViewChecked {
  @ViewChild('sidenav') sideNav: MatSidenav;
  public actionButtons: ActionButton[] = [];
  public title;
  private actionButtonsSubscription: Subscription;
  private routerEventSubscription: Subscription;

  constructor(
    public router: Router,
    private changeDetectorRef: ChangeDetectorRef,
    private actionButtonService: ActionButtonService,
    private snackBar: MatSnackBar) {
    this.actionButtonsSubscription = this.actionButtonService.getActionButtons().subscribe((actionButtons: Map<string, ActionButton>) => {
      this.actionButtons = Array.from(actionButtons.values());
    });
    this.actionButtonService.addActionButton('openSideNav', new ActionButton('list', () => {
      this.sideNav.toggle();
    }, 'material'));
  }

  ngOnInit() {
    this.routerEventSubscription = this.router.events
      .pipe(filter(event => event instanceof RoutesRecognized))
      .pipe(map((event: RoutesRecognized) => {
        return event.state.root.firstChild.data['title'];
      })).subscribe(title => {
        this.title = title;
      });
  }

  ngAfterViewInit() {

  }

  /**
   * See https://github.com/angular/angular/issues/14748
   */
  ngAfterViewChecked() {
    this.changeDetectorRef.detectChanges();
  }

  ngOnDestroy(): void {
    this.routerEventSubscription.unsubscribe();
    this.actionButtonsSubscription.unsubscribe();
  }
}
