import { DASHBOARD_TILE_PRESENTATIONS } from '../../../../helpers/dashboard-tile-presentation.helper';
import { Component, OnInit } from '@angular/core';
import { AppUserService } from '../../../../services/app.user.service';
import { TileActionsAbstractDirective } from '../tile-actions-abstract.directive';

@Component({
  selector: 'app-tile-map-actions',
  templateUrl: '../tile-actions-menu.html',
  styleUrls: ['../tile.actions.abstract.css'],
  providers: [],
  standalone: false
})
export class TileMapActionsComponent extends TileActionsAbstractDirective implements OnInit {
  override presentation = DASHBOARD_TILE_PRESENTATIONS.map;

  constructor(
    userService: AppUserService) {
    super(userService);
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error('Component needs user');
    }
  }
}
