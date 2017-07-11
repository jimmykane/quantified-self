import {AfterViewInit, Component, ViewChild} from '@angular/core';
import {ActionButtonService} from './services/action-buttons/app.action-button.service';
import {ActionButton} from './services/action-buttons/app.action-button';
import {MdSidenav} from '@angular/material';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})

export class AppComponent implements AfterViewInit {
  @ViewChild('sidenav') sideNav: MdSidenav;
  public title = 'Quantified Self';
  public actionButtons;

  constructor(private actionButtonService: ActionButtonService) {
    this.actionButtonService.actionButtons.set('openSideNav', new ActionButton('list', () => {
      this.sideNav.toggle()
    }, 'material'));
    this.actionButtons = [...this.actionButtonService.actionButtons.values()];
  }

  ngAfterViewInit() {

  }
}
