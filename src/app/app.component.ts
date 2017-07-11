import {AfterViewInit, Component, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {ActionButtonService} from './services/action-buttons/app.action-button.service';
import {ActionButton} from './services/action-buttons/app.action-button';
import {MdSidenav} from '@angular/material';
import {Subscription} from "rxjs/Subscription";

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})

export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('sidenav') sideNav: MdSidenav;
  public title = 'Quantified Self';
  public actionButtons: ActionButton[] = [];
  private actionButtonsSubscription: Subscription;


  constructor(private actionButtonService: ActionButtonService) {
    this.actionButtonService.addActionButton('openSideNav', new ActionButton('list', () => {
      this.sideNav.toggle();
    }, 'material'));
  }

  ngOnInit() {
    this.actionButtonsSubscription = this.actionButtonService.getActionButtons().subscribe((actionButtons: Map<string, ActionButton>) => {
      this.actionButtons = [...actionButtons.values()];
    });
  }

  ngAfterViewInit() {

  }

  ngOnDestroy(): void {
    this.actionButtonsSubscription.unsubscribe();
  }
}
