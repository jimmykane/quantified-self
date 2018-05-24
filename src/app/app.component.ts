import {
  AfterViewChecked, AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit,
  ViewChild
} from '@angular/core';
import {ActionButtonService} from './services/action-buttons/app.action-button.service';
import {ActionButton} from './services/action-buttons/app.action-button';
import {MatSidenav} from '@angular/material';
import {Subscription} from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class AppComponent implements OnInit, AfterViewInit, OnDestroy, AfterViewChecked {
  @ViewChild('sidenav') sideNav: MatSidenav;
  public actionButtons: ActionButton[] = [];
  private actionButtonsSubscription: Subscription;


  constructor(private changeDetectorRef: ChangeDetectorRef, private actionButtonService: ActionButtonService) {
    this.actionButtonsSubscription = this.actionButtonService.getActionButtons().subscribe((actionButtons: Map<string, ActionButton>) => {
      this.actionButtons = Array.from(actionButtons.values());
    });
    this.actionButtonService.addActionButton('openSideNav', new ActionButton('list', () => {
      this.sideNav.toggle();
    }, 'material'));
  }

  ngOnInit() {
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
    this.actionButtonsSubscription.unsubscribe();
  }
}
